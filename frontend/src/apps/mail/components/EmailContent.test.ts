import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'

import EmailContent from '@/apps/mail/components/EmailContent.vue'

// The stubbed frame hands its emit back, so a test can say when the resizer reports ready.
const resizer = vi.hoisted(() => ({ reportReady: () => {} }))

vi.mock('@iframe-resizer/vue/iframe-resizer.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      emits: ['onReady'],
      setup(_props, { emit }) {
        resizer.reportReady = () => emit('onReady')
        return () => h('iframe', { 'data-frame': '' })
      },
    }),
  }
})

vi.mock('@iframe-resizer/child/index.umd.js?raw', () => ({ default: '' }))

vi.mock('@/apps/mail/utils', () => ({
  analyzeRemoteAssets: () => ({ images: 0, hasRemote: false }),
  blockRemoteAssets: (html: string) => html,
}))

vi.mock('@/apps/mail/utils/composables', () => ({
  useTheme: () => ({ dataTheme: { value: 'light' } }),
  useScreenSize: () => ({ isMobile: { value: false } }),
  useComposeMail: () => ({ requestCompose: () => {} }),
}))

// Torn down between tests: the component listens on `window` for the frame's messages, and a
// mount left standing would still be listening while the next test runs.
const mounted: App[] = []

const mount = (content = '<p>A message with a body.</p>', props: Record<string, unknown> = {}) => {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(EmailContent, { content, ...props })
  app.mount(root)
  mounted.push(app)
  return root
}

const frame = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-frame]')
const placeholder = (root: HTMLElement) => root.querySelector('.animate-pulse')

beforeEach(() => {
  window.__ = (message: string) => message
  resizer.reportReady = () => {}
  document.body.innerHTML = ''
})

afterEach(() => {
  mounted.splice(0).forEach((app) => app.unmount())
})

describe('EmailContent', () => {
  // The frame is measured by asking the document inside it how tall it is, so it has to be laid
  // out the whole time — taken out of the layout it reports 1px, and stops reporting at all.
  it('lays the frame out while it is still waiting to be ready', async () => {
    const root = mount()
    await nextTick()

    expect(frame(root)).not.toBeNull()
    expect(frame(root)!.style.display).not.toBe('none')
    expect(placeholder(root)).not.toBeNull()
  })

  it('shows the frame and drops the placeholder once the resizer reports ready', async () => {
    const root = mount()
    await nextTick()

    resizer.reportReady()
    await nextTick()

    expect(frame(root)!.style.display).not.toBe('none')
    expect(frame(root)!.className).not.toContain('invisible')
    expect(placeholder(root)).toBeNull()
  })

  it("folds away an Apple Mail reply's quoted trail", async () => {
    const root = mount(
      '<div>Thanks, will do.</div><blockquote type="cite"><div>On 4 Feb, Ana wrote:</div><div>Can you send it?</div></blockquote>',
    )
    await nextTick()

    const doc = new DOMParser().parseFromString(frame(root)!.getAttribute('srcdoc')!, 'text/html')
    expect(doc.querySelector('.quote-toggle')).not.toBeNull()
    expect(doc.querySelector('blockquote')!.classList).toContain('quote-hidden')
  })
})

describe('dates in a message', () => {
  // Sent on Monday 16 November 2026.
  const sentAt = '2026-11-16T09:00:00Z'
  const shown = async (root: HTMLElement) => {
    await vi.waitFor(() => expect(frame(root)?.getAttribute('srcdoc')).toBeTruthy())
    return new DOMParser().parseFromString(frame(root)!.getAttribute('srcdoc')!, 'text/html')
  }

  it('marks a date in its own words for the reader to pick, and nothing in its links or code', async () => {
    const root = mount(
      '<p>Can we meet Thursday at 3pm?</p><p><a href="https://example.com">tomorrow 10:30</a> <code>20 Nov 14:00</code></p>',
      { sentAt },
    )
    const doc = await shown(root)
    expect([...doc.querySelectorAll('[data-mail-date]')].map((mark) => mark.textContent)).toEqual([
      'Thursday at 3pm',
    ])
  })

  it('asks for an event at the date picked in its frame', async () => {
    const onPickDate = vi.fn()
    const root = mount('<p>Can we meet Thursday at 3pm?</p>', { sentAt, onPickDate })
    await shown(root)
    const own = frame(root)
    if (!(own instanceof HTMLIFrameElement)) throw new Error('no frame')
    const pick = (source: Window | null) =>
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'mail-date', index: '0' }, source }),
      )

    // A window other than this message's own frame can't ask for one.
    pick(window)
    expect(onPickDate).not.toHaveBeenCalled()

    pick(own.contentWindow)
    expect(onPickDate).toHaveBeenCalledWith(
      expect.objectContaining({ start: expect.objectContaining({ date: '2026-11-19' }) }),
    )
  })

  it('marks nothing when it is not offered as an event', async () => {
    const root = mount('<p>Can we meet Thursday at 3pm?</p>')
    await nextTick()
    const doc = new DOMParser().parseFromString(frame(root)!.getAttribute('srcdoc')!, 'text/html')
    expect(doc.querySelector('[data-mail-date]')).toBeNull()
  })

  // The frame's own script, run in a document of its own as the frame would: what a press inside
  // the message does.
  const inFrame = async (content: string) => {
    const root = mount(content, { sentAt })
    await shown(root)
    const dom = new JSDOM(frame(root)!.getAttribute('srcdoc')!, { runScripts: 'dangerously' })
    const posted = vi.fn()
    const opened = vi.fn()
    // The frame's parent is itself here.
    dom.window.postMessage = posted
    dom.window.open = opened
    const press = (element: Element) =>
      !element.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
      )
    // A press as a pointer makes it: down at one spot, up and the click at another.
    const pointer = (type: string, element: Element, x: number) =>
      element.dispatchEvent(
        new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: 10 }),
      )
    const drag = (element: Element, from: number, to: number, during = () => {}) => {
      pointer('pointerdown', element, from)
      during()
      pointer('pointerup', element, to)
      pointer('click', element, to)
    }
    return {
      document: dom.window.document,
      window: dom.window,
      posted,
      opened,
      press,
      drag,
      pointer,
    }
  }

  it('asks the app for an event when a date is pressed, and does nothing else with the press', async () => {
    const { document, posted, press } = await inFrame('<p>Can we meet Thursday at 3pm?</p>')
    const mark = document.querySelector('[data-mail-date]')!
    expect(press(mark)).toBe(true)
    expect(posted).toHaveBeenCalledWith({ type: 'mail-date', index: '0' }, '*')
  })

  it('lets a drag that starts on a date select text, and opens nothing for it', async () => {
    const { document, posted, drag } = await inFrame('<p>Can we meet Thursday at 3pm?</p>')
    const mark = document.querySelector('[data-mail-date]')!
    // A browser starts no selection at a focusable element, so the date isn't one while pressed.
    drag(mark, 10, 120, () => expect(mark.hasAttribute('tabindex')).toBe(false))
    expect(posted).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'mail-date' }), '*')
    // Tab reaches it again once the press is over.
    expect(mark.getAttribute('tabindex')).toBe('0')
  })

  it('takes a click with no press of its own, as a screen reader makes, for a pick', async () => {
    const { document, posted, pointer } = await inFrame(
      '<p>Can we meet Thursday at 3pm?</p><p>Elsewhere.</p>',
    )
    // An earlier press somewhere else in the message, far from the date.
    pointer('pointerdown', document.querySelectorAll('p')[1], 300)
    pointer('pointerup', document.querySelectorAll('p')[1], 300)
    pointer('click', document.querySelectorAll('p')[1], 300)
    pointer('click', document.querySelector('[data-mail-date]')!, 0)
    expect(posted.mock.calls.filter(([data]) => data.type === 'mail-date')).toEqual([
      [{ type: 'mail-date', index: '0' }, '*'],
    ])
  })

  it('puts a date back in the Tab order when a drag from it is let go outside the frame', async () => {
    const { document, pointer } = await inFrame('<p>Can we meet Thursday at 3pm?</p>')
    const mark = document.querySelector('[data-mail-date]')!
    pointer('pointerdown', mark, 10)
    expect(mark.hasAttribute('tabindex')).toBe(false)
    // No pointerup reaches the frame; the pointer comes back with no button down.
    pointer('pointermove', document.body, 50)
    expect(mark.getAttribute('tabindex')).toBe('0')
  })

  it('takes a tap in place for a pick', async () => {
    const { document, posted, drag } = await inFrame('<p>Can we meet Thursday at 3pm?</p>')
    drag(document.querySelector('[data-mail-date]')!, 10, 12)
    expect(posted).toHaveBeenCalledWith({ type: 'mail-date', index: '0' }, '*')
  })

  it('does not take a press that ends a selection for a pick', async () => {
    const { document, window, posted, press } = await inFrame('<p>Can we meet Thursday at 3pm?</p>')
    window.getSelection()!.selectAllChildren(document.querySelector('p')!)
    press(document.querySelector('[data-mail-date]')!)
    expect(posted).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'mail-date' }), '*')
  })

  it('gives a mail that forges a date around a link no way past the link handling', async () => {
    const { document, posted, opened, press } = await inFrame(
      '<p><span data-mail-date="0"><a href="https://evil.example/" target="_top">Invoice</a></span></p>' +
        '<p>Can we meet Thursday at 3pm?</p>',
    )
    const link = document.querySelector('a')!
    expect(link.closest('[data-mail-date]')).toBeNull()
    // The frame never follows the link itself; it opens it in a tab of its own.
    expect(press(link)).toBe(true)
    expect(opened).toHaveBeenCalledWith('https://evil.example/', '_blank')
    expect(posted).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'mail-date' }), '*')
  })
})
