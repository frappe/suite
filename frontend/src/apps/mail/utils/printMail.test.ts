import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  allowsInline,
  allowsLoad,
  headPolicy,
  type Fetch,
} from '@/apps/mail/utils/contentPolicy.test-support'
import { printMessages, type PrintedMessage } from '@/apps/mail/utils/printMail'

// Dates print in the zone from the user's Settings, here one that is neither UTC nor the machine's.
vi.mock('@/platform/time-zone', () => ({ userTimeZone: () => 'America/Los_Angeles' }))

beforeEach(() => {
  window.__ = (message: string, args?: string[]) =>
    args ? message.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]) : message
})
afterEach(() => {
  document.querySelectorAll('iframe').forEach((frame) => frame.remove())
})

// The page as the print frame holds it.
const printPage = (subject: string, messages: PrintedMessage[]) => {
  printMessages(subject, messages)
  const frame = document.querySelector('iframe')!
  return new DOMParser().parseFromString(frame.getAttribute('srcdoc')!, 'text/html')
}

const message = {
  from: 'Ana Silva <ana@example.com>',
  to: 'Bo <bo@example.com>',
  cc: '',
  bcc: '',
  // 2 AM UTC on the 19th is still the evening of the 18th in Los Angeles (PDT, UTC−7).
  receivedAt: '2026-10-19T02:00:00Z',
  body: '<p>The <b>invoice</b> is attached.</p><script>alert(1)</script>',
  blockRemote: false,
  attachments: ['invoice.pdf', 'terms.pdf'],
}

// The sender's style rules as they reach the printed page: each selector with its declarations.
const senderRules = (section: Element) =>
  [...section.querySelectorAll('style')].flatMap((style) =>
    [...(style.textContent ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
      ([, selector, declarations]) => ({ selector: selector.trim(), declarations }),
    ),
  )

// Everything on the page that would make the printer fetch something from the sender's servers:
// a loading attribute, or a CSS url(), pointing off the message.
const remoteLoads = (doc: Document) => {
  const found: string[] = []
  for (const element of doc.querySelectorAll('*')) {
    const css = element.tagName === 'STYLE' ? element.textContent : element.getAttribute('style')
    const values = [
      ...['src', 'srcset', 'background', 'poster'].map((name) => element.getAttribute(name) ?? ''),
      ...((css ?? '').match(/url\([^)]*\)/gi) ?? []),
    ]
    for (const value of values) if (/(?:https?:)?\/\//i.test(value)) found.push(value)
  }
  return found
}

describe('the printed page', () => {
  it('heads each message with who sent it, to whom and when, and names its attachments', () => {
    const doc = printPage('Invoice for October', [message])

    expect(doc.title).toBe('Invoice for October')
    expect(doc.querySelector('h1')!.textContent).toBe('Invoice for October')
    const header = doc.querySelector('.header')!.textContent!.replace(/\s+/g, ' ').trim()
    expect(header).toBe(
      'Ana Silva <ana@example.com> To: Bo <bo@example.com> Date: Sun, 18 Oct 2026 at 7:00 PM',
    )
    expect(doc.querySelector('.attachments')!.textContent).toBe(
      '2 attachments: invoice.pdf, terms.pdf',
    )
  })

  // Bcc is on the sender's own copy only; there it is part of who the message went to.
  it('lists the Bcc recipients on a copy that has them', () => {
    const doc = printPage('Invoice', [{ ...message, bcc: 'Cy <cy@example.com>' }])

    const header = doc.querySelector('.header')!.textContent!.replace(/\s+/g, ' ')
    expect(header).toContain('To: Bo <bo@example.com> Bcc: Cy <cy@example.com>')
  })

  it("keeps the body's words and leaves out its scripts", () => {
    const doc = printPage('Invoice', [message])

    expect(doc.querySelector('.message p')!.textContent).toBe('The invoice is attached.')
    expect(doc.querySelector('script')).toBeNull()
  })

  it("keeps a newsletter's own styles, applied to its own message and nothing else", () => {
    const newsletter = `<html><head><style>
        body { background: black }
        div { color: red }
        .cta { color: #c00 }
      </style></head><body><div><p class="cta">Shop the sale</p></div></body></html>`
    const doc = printPage('Sale', [{ ...message, body: newsletter, attachments: [] }])

    const section = doc.querySelector('.message')!
    const header = section.querySelector('.header')!
    const rules = senderRules(section)
    const cta = doc.querySelector('.cta')!
    expect(
      rules.some((rule) => cta.matches(rule.selector) && /color/.test(rule.declarations)),
    ).toBe(true)
    for (const rule of rules) {
      for (const reached of doc.querySelectorAll(rule.selector)) {
        expect(section.contains(reached) && !header.contains(reached)).toBe(true)
      }
    }
  })

  // Mail still hides its stylesheet from old clients inside an HTML comment or a CDATA section;
  // CSS reads past both, so the print keeps the rules, the @media ones that stack a newsletter's
  // columns included.
  it.each([
    ['an HTML comment', '<!--', '-->'],
    ['a CDATA section', '/*<![CDATA[*/', '/*]]>*/'],
  ])(
    'keeps the rules of a stylesheet wrapped in %s, applied to its own message',
    (_, open, close) => {
      const newsletter = `<html><head><style>${open}
        .cta { color: #c00 }
        @media (max-width: 600px) { .column { display: block } }
      ${close}</style></head><body>
        <div class="column"><p class="cta">Shop the sale</p></div></body></html>`
      const doc = printPage('Sale', [{ ...message, body: newsletter, attachments: [] }])

      const section = doc.querySelector('.message')!
      const header = section.querySelector('.header')!
      const rules = senderRules(section)
      const cta = doc.querySelector('.cta')!
      const column = doc.querySelector('.column')!
      expect(
        rules.some((rule) => cta.matches(rule.selector) && /color/.test(rule.declarations)),
      ).toBe(true)
      expect(
        rules.some((rule) => column.matches(rule.selector) && /display/.test(rule.declarations)),
      ).toBe(true)
      for (const rule of rules) {
        for (const reached of doc.querySelectorAll(rule.selector)) {
          expect(section.contains(reached) && !header.contains(reached)).toBe(true)
        }
      }
    },
  )

  it('loads nothing remote from a message whose remote content is blocked, until it is allowed', () => {
    const tracked = `<table background="https://t.example/bg.png"><tr><td>
        <img src="https://t.example/a.png" srcset="https://t.example/a@2x.png 2x" alt="Logo">
        <video poster="https://t.example/poster.png" src="https://t.example/clip.mp4"></video>
        <div style="background-image: url(https://t.example/px.gif)">Hello</div>
      </td></tr></table>
      <style>.hero { background: url('https://t.example/hero.png') }</style>`
    const blocked = printPage('News', [{ ...message, body: tracked, blockRemote: true }])
    const allowed = printPage('News', [{ ...message, body: tracked, blockRemote: false }])

    expect(blocked.querySelector('.message')!.textContent).toContain('Hello')
    expect(remoteLoads(blocked)).toEqual([])
    expect(allowed.querySelector('img[alt="Logo"]')!.getAttribute('src')).toBe(
      'https://t.example/a.png',
    )
  })

  // The page takes the app's origin, which is where the server points inline (cid:) images.
  it('has the browser refuse every remote load while any message on the page is withheld', () => {
    const app = window.location.origin
    const withheld = printPage('News', [message, { ...message, blockRemote: true }])
    const shown = printPage('News', [message, { ...message, body: '<p>Thanks!</p>' }])
    const fetches: Fetch[] = ['img', 'font', 'style', 'media', 'connect', 'frame', 'object']
    const remote = 'https://t.example/a.png'

    const refused = headPolicy(withheld)
    for (const fetch of fetches) expect(allowsLoad(refused, fetch, remote, app), fetch).toBe(false)
    expect(allowsLoad(refused, 'img', '/api/method/suite.mail.api.mail.get_attachment', app)).toBe(
      true,
    )
    expect(allowsLoad(refused, 'img', 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', app)).toBe(true)
    expect(
      allowsLoad(refused, 'img', '/api/method/suite.sheets.link_preview.get_link_preview', app),
    ).toBe(false)
    expect(allowsInline(refused, 'style')).toBe(true)

    const allowed = headPolicy(shown)
    for (const fetch of ['img', 'font', 'style'] as const)
      expect(allowsLoad(allowed, fetch, remote, app), fetch).toBe(true)
    expect(allowsInline(allowed, 'script')).toBe(false)
  })

  it('prints a conversation as one section per message, in order', () => {
    const reply = {
      ...message,
      from: 'Bo <bo@example.com>',
      body: '<p>Thanks!</p>',
      attachments: [],
    }
    const doc = printPage('Invoice', [message, reply])

    expect([...doc.querySelectorAll('.message .from')].map((e) => e.textContent)).toEqual([
      'Ana Silva <ana@example.com>',
      'Bo <bo@example.com>',
    ])
  })
})

describe('printing', () => {
  it('prints from a frame that runs no scripts but may still open the print dialog', () => {
    printMessages('Invoice', [message])

    const frame = document.querySelector('iframe')!
    const allowed = (frame.getAttribute('sandbox') ?? '').split(/\s+/)
    expect(frame.hasAttribute('sandbox')).toBe(true)
    expect(allowed).not.toContain('allow-scripts')
    // A sandboxed frame ignores print() without allow-modals, and this window may only call it on
    // a frame of its own origin.
    expect(allowed).toContain('allow-modals')
    expect(allowed).toContain('allow-same-origin')
  })
})
