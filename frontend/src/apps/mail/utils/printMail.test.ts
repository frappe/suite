import { beforeEach, describe, expect, it } from 'vitest'

import { printPage } from '@/apps/mail/utils/printMail'

beforeEach(() => {
  window.__ = (message: string, args?: string[]) =>
    args ? message.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]) : message
})

const page = (html: string) => new DOMParser().parseFromString(html, 'text/html')

const message = {
  from: 'Ana Silva <ana@example.com>',
  to: 'Bo <bo@example.com>',
  cc: '',
  date: 'Mon, 19 Oct 2026 at 4:12 PM',
  body: '<style>body { background: black }</style><p>The <b>invoice</b> is attached.</p><script>alert(1)</script>',
  attachments: ['invoice.pdf', 'terms.pdf'],
}

describe('the printed page', () => {
  it('heads each message with who sent it, to whom and when, and names its attachments', () => {
    const doc = page(printPage('Invoice for October', [message]))

    expect(doc.title).toBe('Invoice for October')
    expect(doc.querySelector('h1')!.textContent).toBe('Invoice for October')
    const header = doc.querySelector('.header')!.textContent!.replace(/\s+/g, ' ').trim()
    expect(header).toBe(
      'Ana Silva <ana@example.com> To: Bo <bo@example.com> Date: Mon, 19 Oct 2026 at 4:12 PM',
    )
    expect(doc.querySelector('.attachments')!.textContent).toBe(
      '2 attachments: invoice.pdf, terms.pdf',
    )
  })

  it("keeps the body's words, leaves out its scripts, and keeps its styles to itself", () => {
    const doc = page(printPage('Invoice', [message]))

    expect(doc.querySelector('.message p')!.textContent).toBe('The invoice is attached.')
    expect(doc.querySelector('script')).toBeNull()
    const senderCss = [...doc.querySelectorAll('.message style')].map((s) => s.textContent).join()
    expect(senderCss).not.toMatch(/(^|[\s,}])body\s*\{/)
  })

  it('prints a conversation as one section per message, in order', () => {
    const reply = {
      ...message,
      from: 'Bo <bo@example.com>',
      body: '<p>Thanks!</p>',
      attachments: [],
    }
    const doc = page(printPage('Invoice', [message, reply]))

    expect([...doc.querySelectorAll('.message .from')].map((e) => e.textContent)).toEqual([
      'Ana Silva <ana@example.com>',
      'Bo <bo@example.com>',
    ])
  })
})
