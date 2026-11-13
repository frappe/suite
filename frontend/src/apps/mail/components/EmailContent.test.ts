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

  // The thread prints the conversation when it hears ⌘P from the frame; the browser printing the
  // whole app first would be a second, wrong print.
  it('keeps ⌘P and Ctrl+P inside a message from the browser, and still hands them to the thread', async () => {
    const root = mount()
    await nextTick()

    const srcdoc = new DOMParser().parseFromString(
      frame(root)!.getAttribute('srcdoc')!,
      'text/html',
    )
    const script = [...srcdoc.querySelectorAll('script')].find((s) =>
      s.textContent?.includes("'keydown'"),
    )!.textContent!
    const inner = document.implementation.createHTMLDocument('')
    const forwarded = vi.fn()
    const frameWindow = { parent: { postMessage: forwarded }, addEventListener: () => {} }
    // The frame's own script, run against a document of its own as the frame would run it.
    new Function('window', 'document', script)(frameWindow, inner)
    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })
      inner.body.dispatchEvent(event)
      return event
    }

    expect(press({ key: 'p', metaKey: true }).defaultPrevented).toBe(true)
    expect(press({ key: 'p', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(press({ key: 'p' }).defaultPrevented).toBe(false)
    expect(press({ key: 'f', metaKey: true }).defaultPrevented).toBe(false)
    expect(forwarded).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'keyboard', eventType: 'keydown', key: 'p', metaKey: true }),
      '*',
    )
  })
})
