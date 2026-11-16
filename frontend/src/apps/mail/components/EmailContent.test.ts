import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'

import EmailContent from '@/apps/mail/components/EmailContent.vue'

// The stubbed frame hands its emit back, so a test can say when the resizer reports ready.
const resizer = vi.hoisted(() => ({ reportReady: () => {} }))
// Which platform the reader is on: the print chord is ⌘P on a Mac and Ctrl+P elsewhere.
const platform = vi.hoisted(() => ({ mac: true }))

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
  get isMac() {
    return platform.mac
  },
}))

vi.mock('@/apps/mail/utils/composables', () => ({
  useTheme: () => ({ dataTheme: { value: 'light' } }),
  useScreenSize: () => ({ isMobile: { value: false } }),
  useComposeMail: () => ({ requestCompose: () => {} }),
}))

// Torn down between tests: the component listens on `window` for the frame's messages, and a
// mount left standing would still be listening while the next test runs.
const mounted: App[] = []

const mount = (content = '<p>A message with a body.</p>') => {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(EmailContent, { content })
  app.mount(root)
  mounted.push(app)
  return root
}

const frame = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-frame]')
const placeholder = (root: HTMLElement) => root.querySelector('.animate-pulse')

beforeEach(() => {
  window.__ = (message: string) => message
  resizer.reportReady = () => {}
  platform.mac = true
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

  // The frame's own script, run against a document of its own as the frame would run it: presses
  // a key inside it and says whether the browser was kept from acting on it.
  const frameKeys = (root: HTMLElement, forwarded = vi.fn()) => {
    const srcdoc = new DOMParser().parseFromString(
      frame(root)!.getAttribute('srcdoc')!,
      'text/html',
    )
    const script = [...srcdoc.querySelectorAll('script')].find((s) =>
      s.textContent?.includes("'keydown'"),
    )!.textContent!
    const inner = document.implementation.createHTMLDocument('')
    const frameWindow = { parent: { postMessage: forwarded }, addEventListener: () => {} }
    new Function('window', 'document', script)(frameWindow, inner)
    return (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })
      inner.body.dispatchEvent(event)
      return event.defaultPrevented
    }
  }

  // The thread prints the conversation when it hears ⌘P from the frame; the browser printing the
  // whole app first would be a second, wrong print.
  it('keeps ⌘P inside a message from the browser on a Mac, and still hands it to the thread', async () => {
    const root = mount()
    await nextTick()
    const forwarded = vi.fn()
    const press = frameKeys(root, forwarded)

    expect(press({ key: 'p', metaKey: true })).toBe(true)
    // Ctrl+P is no print chord on a Mac.
    expect(press({ key: 'p', ctrlKey: true })).toBe(false)
    expect(press({ key: 'p' })).toBe(false)
    expect(press({ key: 'f', metaKey: true })).toBe(false)
    expect(forwarded).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'keyboard', eventType: 'keydown', key: 'p', metaKey: true }),
      '*',
    )
  })

  it('keeps Ctrl+P inside a message from the browser off a Mac, and leaves ⌘P alone', async () => {
    platform.mac = false
    const root = mount()
    await nextTick()
    const press = frameKeys(root)

    expect(press({ key: 'p', ctrlKey: true })).toBe(true)
    expect(press({ key: 'p', metaKey: true })).toBe(false)
  })

  // Each expanded message listens on the same window; were every one to replay every frame's keys,
  // one ⌘P in a three-message thread would print it three times.
  it("replays a key pressed in its own message once, and not a key from any other window's", async () => {
    const first = mount()
    mount()
    await nextTick()
    const presses = vi.fn()
    document.addEventListener('keydown', presses)
    const send = (source: Window | null) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'keyboard', eventType: 'keydown', key: 'p', metaKey: true },
          source,
        }),
      )

    send(first.querySelector<HTMLIFrameElement>('[data-frame]')!.contentWindow)
    expect(presses).toHaveBeenCalledTimes(1)

    send(null)
    expect(presses).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', presses)
  })
})
