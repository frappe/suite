import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'

import EmailContent from '@/apps/mail/components/EmailContent.vue'

// The app's theme, which a test switches before it mounts.
interface Theme {
  value: 'light' | 'dark'
}
const theme = vi.hoisted((): Theme => ({ value: 'light' }))
// Which platform the reader is on: the print chord is ⌘P on a Mac and Ctrl+P elsewhere.
const platform = vi.hoisted(() => ({ mac: true }))

vi.mock('@/apps/mail/utils', () => ({
  analyzeRemoteAssets: () => ({ images: 0, hasRemote: false }),
  blockRemoteAssets: (html: string) => html,
  get isMac() {
    return platform.mac
  },
}))

vi.mock('@/apps/mail/utils/composables', () => ({
  useTheme: () => ({ dataTheme: theme }),
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

const frame = (root: HTMLElement) => root.querySelector('iframe')
const rendered = (root: HTMLElement) =>
  new DOMParser().parseFromString(frame(root)!.getAttribute('srcdoc')!, 'text/html')
const stylesheets = (doc: Document) =>
  [...doc.querySelectorAll('style')].map((style) => style.textContent).join('\n')
const waiting = (root: HTMLElement) => frame(root)!.classList.contains('invisible')

// The frame's document with its own scripts run, as the frame runs them. Nothing is laid out
// here, so the pane's width and the width the message takes up are given; changing them and
// sending a resize stands in for the pane changing size. The message's width can instead follow
// the body's, for content sized from it. The body is as wide as it is held, else as the root it is
// laid out in, else it fills the pane on screen, which a zoomed body outgrows by the zoom.
// The message's height is given the same way, as a number or read off the document, and `settle`
// is the browser's part once it has laid the message out: it tells whoever watches the message's
// box that the box changed, if it did. A collapsed message is not laid out: its root has no box,
// though its window keeps the width it had, as in Chrome. What
// the document then posts to its parent reaches the page as coming from this message's frame.
type Pane = {
  width: number
  content: number | ((body: number) => number)
  height?: number | ((message: Document) => number)
  // How far down the message's content reaches, when something is drawn below its box.
  reach?: number
  // False while the message is collapsed.
  laidOut?: boolean
}
const framed = (root: HTMLElement, pane: Pane) => {
  const box = (message: Document) =>
    pane.laidOut === false
      ? { width: 0, height: 0 }
      : {
          width: pane.width,
          height: typeof pane.height === 'function' ? pane.height(message) : (pane.height ?? 0),
        }
  let watcher = () => {}
  let watched = { width: 0, height: 0 }
  const { window: inner } = new JSDOM(frame(root)!.getAttribute('srcdoc')!, {
    runScripts: 'dangerously',
    beforeParse(window) {
      const bodyWidth = () => {
        const { body, documentElement } = window.document
        return (
          parseFloat(body.style.width) ||
          parseFloat(documentElement.style.width) ||
          pane.width / (Number(body.style.zoom) || 1)
        )
      }
      const measure = (pick: () => number) => ({
        get(this: Element) {
          return this === this.ownerDocument.documentElement ? pick() : 0
        },
      })
      Object.defineProperty(
        window.Element.prototype,
        'clientWidth',
        measure(() => pane.width),
      )
      Object.defineProperty(
        window.Element.prototype,
        'scrollWidth',
        measure(() =>
          typeof pane.content === 'number' ? pane.content : pane.content(bodyWidth()),
        ),
      )
      Object.defineProperty(window.HTMLBodyElement.prototype, 'getBoundingClientRect', {
        value: () => ({ width: bodyWidth() }),
      })
      Object.defineProperty(window.HTMLHtmlElement.prototype, 'scrollHeight', {
        get: () => pane.reach ?? box(window.document).height,
      })
      Object.defineProperty(window.HTMLHtmlElement.prototype, 'getBoundingClientRect', {
        value: () => box(window.document),
      })
      Object.assign(window, {
        ResizeObserver: class {
          constructor(changed: () => void) {
            watcher = changed
          }
          observe() {}
        },
      })
      Object.defineProperty(window, 'parent', {
        value: {
          postMessage: (data: unknown) =>
            globalThis.window.dispatchEvent(
              new MessageEvent('message', { data, source: frame(root)!.contentWindow }),
            ),
        },
      })
    },
  })
  const settle = () => {
    const now = box(inner.document)
    if (now.width === watched.width && now.height === watched.height) return
    watched = now
    watcher()
  }
  return { window: inner, settle }
}

const REPLY =
  '<div>Thanks, will do.</div><blockquote type="cite"><div>On 4 Feb, Ana wrote:</div><div>Can you send it?</div></blockquote>'

beforeEach(() => {
  window.__ = (message: string) => message
  theme.value = 'light'
  platform.mac = true
  document.body.innerHTML = ''
})

afterEach(() => {
  mounted.splice(0).forEach((app) => app.unmount())
})

describe('EmailContent', () => {
  // The frame is made as tall as the document inside it says it is, so it has to be laid out
  // the whole time: taken out of the layout, its document has no height to say.
  it('lays the frame out while it is still waiting to be measured', async () => {
    const root = mount()
    await nextTick()

    expect(frame(root)).not.toBeNull()
    expect(frame(root)!.style.display).not.toBe('none')
    expect(waiting(root)).toBe(true)
    // Hidden, it takes no room: what follows the message does not wait below an empty gap.
    expect(frame(root)!.style.height).toBe('0px')
  })

  it("folds away an Apple Mail reply's quoted trail", async () => {
    const root = mount(REPLY)
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

    send(frame(first)!.contentWindow)
    expect(presses).toHaveBeenCalledTimes(1)

    send(null)
    expect(presses).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', presses)
  })
})

describe('EmailContent makes its frame as tall as its message', () => {
  it('shows the frame once, at the height of the message', async () => {
    const root = mount()
    await nextTick()

    framed(root, { width: 600, content: 600, height: 420 }).settle()
    await nextTick()

    expect(frame(root)!.style.height).toBe('420px')
    expect(waiting(root)).toBe(false)
  })

  it('grows when the quoted trail is shown, and shrinks back when it is hidden again', async () => {
    const root = mount(REPLY)
    await nextTick()
    const { window, settle } = framed(root, {
      width: 600,
      content: 600,
      height: (message) => (message.querySelector('blockquote.quote-hidden') ? 120 : 900),
    })
    const toggle = window.document.querySelector<HTMLElement>('.quote-toggle')!
    settle()
    await nextTick()
    expect(frame(root)!.style.height).toBe('120px')

    toggle.click()
    settle()
    await nextTick()
    expect(frame(root)!.style.height).toBe('900px')

    toggle.click()
    settle()
    await nextTick()
    expect(frame(root)!.style.height).toBe('120px')
  })

  // An image that arrives late, or the pane narrowing and the text wrapping onto more lines. A
  // height between two pixels is rounded up, so the last line is never cut.
  it('follows the message as it is laid out again, never a pixel short of it', async () => {
    const root = mount()
    await nextTick()
    const pane: Pane = { width: 600, content: 600, height: 420 }
    const { settle } = framed(root, pane)
    settle()

    Object.assign(pane, { width: 360, height: 1310.25 })
    settle()
    await nextTick()

    expect(frame(root)!.style.height).toBe('1311px')
  })

  // A block the sender positioned below the rest of the message is part of it, not cut off.
  it('makes room for content drawn below the rest of the message', async () => {
    const root = mount()
    await nextTick()

    framed(root, { width: 600, content: 600, height: 48, reach: 700 }).settle()
    await nextTick()

    expect(frame(root)!.style.height).toBe('700px')
  })

  // A message is mounted collapsed when it is not the last of its thread, and collapsed it has
  // no layout to measure.
  it('stays hidden until a collapsed message is opened', async () => {
    const root = mount()
    await nextTick()
    const pane: Pane = { width: 600, content: 600, height: 420, laidOut: false }
    const { settle } = framed(root, pane)
    settle()
    await nextTick()
    expect(waiting(root)).toBe(true)

    Object.assign(pane, { laidOut: true })
    settle()
    await nextTick()
    expect(frame(root)!.style.height).toBe('420px')
    expect(waiting(root)).toBe(false)
  })

  it('keeps its height while its message is collapsed, to open at it again', async () => {
    const root = mount()
    await nextTick()
    const pane: Pane = { width: 600, content: 600, height: 420 }
    const { settle } = framed(root, pane)
    settle()

    Object.assign(pane, { laidOut: false })
    settle()
    await nextTick()

    expect(frame(root)!.style.height).toBe('420px')
    expect(waiting(root)).toBe(false)
  })

  // A sheet that fills its window would make the message as tall as its frame, whatever its
  // content, and the frame could never shrink to it.
  it('measures a message by its content when its own sheet says to fill the window', async () => {
    const root = mount(
      '<style>html, body { height: 100% !important; }</style><p>A short message.</p>',
    )
    await nextTick()

    const { window } = framed(root, { width: 600, content: 600 })
    const { documentElement, body } = window.document
    expect(window.getComputedStyle(documentElement).height).toBe('auto')
    expect(window.getComputedStyle(body).height).toBe('auto')
  })

  // Every expanded message hears every frame, and any window that can reach the page can post
  // to it.
  it("takes its height from its own frame only, not from another message's or a stranger", async () => {
    const first = mount()
    const second = mount()
    await nextTick()
    const report = (source: Window | null) =>
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'height', height: 5000 }, source }),
      )

    report(frame(second)!.contentWindow)
    report(null)
    await nextTick()

    expect(frame(first)!.style.height).toBe('0px')
    expect(waiting(first)).toBe(true)
    expect(frame(second)!.style.height).toBe('5000px')
  })

  it('ignores a height that is not a length', async () => {
    const root = mount()
    await nextTick()

    for (const height of ['tall', Number.NaN, Number.POSITIVE_INFINITY, -40, null])
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'height', height },
          source: frame(root)!.contentWindow,
        }),
      )
    await nextTick()

    expect(frame(root)!.style.height).toBe('0px')
    expect(waiting(root)).toBe(true)
  })
})

// Mail that rendered wrong for real, each kept in the shape that broke it, with its content and
// links replaced. Laying a message out takes a browser, so these hold what reaches the frame;
// whether it then fits the pane was checked in one, against the inbox they came from.
const fixtures = import.meta.glob<string>('./fixtures/rendering/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const fixture = (name: string) => fixtures[`./fixtures/rendering/${name}.html`]

describe('EmailContent renders mail as it was sent', () => {
  it('keeps a stylesheet hidden in a CDATA section, with the rules that stack its columns', async () => {
    const root = mount(fixture('responsive-columns-cdata'))
    await nextTick()

    const css = stylesheets(rendered(root))
    expect(css).toContain('@media screen and (max-width: 649px)')
    expect(css).toContain('.tflex { display: block !important; width: 100% !important; }')
  })

  it('keeps a stylesheet hidden in an HTML comment', async () => {
    const root = mount(fixture('comment-wrapped-style'))
    await nextTick()

    const css = stylesheets(rendered(root))
    expect(css).toContain('@media only screen and (max-width: 480px)')
    expect(css).toContain('.hide-on-phone { display: none !important; }')
  })

  it('keeps a stylesheet hidden in a comment that the sender never closed', async () => {
    const root = mount(
      '<p>Hello</p><style><!-- @media only screen and (max-width: 480px) { .stack { display: block !important; } }',
    )
    await nextTick()

    expect(stylesheets(rendered(root))).toContain('.stack { display: block !important; }')
  })

  // Any sender can write this; the tab must not freeze reading it.
  it('renders a body of unclosed style tags without stalling', async () => {
    const started = performance.now()
    const root = mount('<p>Hello</p>' + '<style>'.repeat(150_000))
    await nextTick()

    expect(performance.now() - started).toBeLessThan(1_000)
    expect(rendered(root).body.textContent).toContain('Hello')
  })

  // The table is wider than a phone's pane, and the quote it sits in can't reflow it: it has to
  // be scaled down to the pane, never cut off at its edge, and come back to full size when the
  // pane is wide enough again.
  it('scales a table quoted in a reply down to a narrow pane, and back up when it fits', async () => {
    const root = mount(fixture('bordered-table-in-quote'))
    await nextTick()

    const pane = { width: 360, content: 540 }
    const { window } = framed(root, pane)
    const { body } = window.document
    expect(Number(body.style.zoom)).toBeCloseTo(360 / 540)
    expect(body.querySelectorAll('table td')).toHaveLength(12)

    Object.assign(pane, { width: 800, content: 800 })
    window.dispatchEvent(new window.Event('resize'))
    expect(body.style.zoom).toBe('')
    expect(body.style.width).toBe('')
  })

  // The column takes the body's width plus its 12px padding each side, so it overflows by the same
  // 24px at any width the body is laid out at: scaled, it must still end inside the pane.
  it('scales a column sized from the body down until it ends inside the pane', async () => {
    const root = mount(fixture('comment-wrapped-style'))
    await nextTick()

    const pane: Pane = { width: 362, content: (body) => body + 24 }
    const { window } = framed(root, pane)
    const { documentElement, body } = window.document
    expect(Number(body.style.zoom)).toBeLessThan(1)
    expect(Number(body.style.zoom) * documentElement.scrollWidth).toBeLessThanOrEqual(362)
  })

  // A sent <body style> is the frame's own body: its centred column stays the author's, whether
  // the message fits from the start or was scaled to a narrow pane and then given room again.
  it("keeps the author's own body width, before and after a fit", async () => {
    const root = mount(
      '<body style="max-width:600px;margin:0 auto"><p>A centred column.</p></body>',
    )
    await nextTick()

    const pane = { width: 800, content: 800 }
    const { window } = framed(root, pane)
    const { body } = window.document
    expect(body.style.maxWidth).toBe('600px')

    Object.assign(pane, { width: 360, content: 540 })
    window.dispatchEvent(new window.Event('resize'))
    expect(body.style.zoom).not.toBe('')

    Object.assign(pane, { width: 800, content: 800 })
    window.dispatchEvent(new window.Event('resize'))
    expect(body.style.maxWidth).toBe('600px')
    expect(body.style.width).toBe('')
    expect(body.style.zoom).toBe('')
  })

  it('leaves a message that fits the pane at full size', async () => {
    const root = mount(fixture('bordered-table-in-quote'))
    await nextTick()

    const { window } = framed(root, { width: 800, content: 800 })
    expect(window.document.body.style.zoom).toBe('')
    expect(window.document.body.style.width).toBe('')
  })

  // A long line wraps inside the pane instead of widening the message past it or scrolling
  // sideways, and the block keeps its line breaks and indentation.
  it("wraps a code block's long lines and keeps its own", async () => {
    const root = mount(fixture('code-in-notification'))
    await nextTick()

    const { window } = framed(root, { width: 360, content: 360 })
    const pre = window.document.querySelector('pre')!
    const code = window.document.querySelector('p code')!
    for (const block of [pre, code]) {
      expect(window.getComputedStyle(block).whiteSpace).toBe('pre-wrap')
      expect(['auto', 'scroll']).not.toContain(window.getComputedStyle(block).overflowX)
    }
    expect(pre.textContent).toBe(
      'def get_messages(account, ids):\n' +
        '    cached = _get_cached_messages(account, ids)\n' +
        '    return [cached[id] for id in ids]\n',
    )
  })

  it("leaves out the sender's own dark-scheme rules and keeps the light design", async () => {
    const root = mount(fixture('dark-scheme-rules'))
    await nextTick()

    const css = stylesheets(rendered(root))
    expect(css).not.toContain('prefers-color-scheme')
    expect(css).not.toContain('#0d1117')
    expect(css).toContain('.card { background-color: #ffffff; color: #1f2328; }')
  })

  it('says a message is adapted to the dark theme, and recolours it', async () => {
    theme.value = 'dark'
    const adaptable = vi.fn()
    const root = mount(fixture('dark-scheme-rules'), { onAdaptable: adaptable })
    await nextTick()

    expect(adaptable).toHaveBeenLastCalledWith(true)
    expect(stylesheets(rendered(root))).not.toContain('background-color: #ffffff')
  })

  it('shows an adapted message as sent: every colour as written, on a light canvas', async () => {
    theme.value = 'dark'
    const adaptable = vi.fn()
    const root = mount(fixture('dark-scheme-rules'), { asSent: true, onAdaptable: adaptable })
    await nextTick()

    const doc = rendered(root)
    expect(adaptable).toHaveBeenLastCalledWith(true)
    expect(doc.querySelector('meta[name="color-scheme"]')!.getAttribute('content')).toBe('light')
    expect(stylesheets(doc)).toContain('.card { background-color: #ffffff; color: #1f2328; }')
    expect(stylesheets(doc)).toMatch(/body \{[^}]*background-color: #FFFFFF/)
    expect(doc.querySelector('.card')!.getAttribute('style')).toContain('#d1d9e0')
    expect(doc.body.innerHTML).toContain('color: #cf222e')
  })

  it('in the light theme adapts nothing, so there is nothing to show as sent', async () => {
    const adaptable = vi.fn()
    mount(fixture('dark-scheme-rules'), { onAdaptable: adaptable })
    await nextTick()

    expect(adaptable).toHaveBeenLastCalledWith(false)
  })
})
