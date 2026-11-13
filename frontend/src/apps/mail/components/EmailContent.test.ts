import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'

import EmailContent from '@/apps/mail/components/EmailContent.vue'

// The stubbed frame hands its emit back, so a test can say when the resizer reports ready.
const resizer = vi.hoisted(() => ({ reportReady: () => {} }))
// The app's theme, which a test switches before it mounts.
interface Theme {
  value: 'light' | 'dark'
}
const theme = vi.hoisted((): Theme => ({ value: 'light' }))

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

const frame = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-frame]')
const rendered = (root: HTMLElement) =>
  new DOMParser().parseFromString(frame(root)!.getAttribute('srcdoc')!, 'text/html')
const stylesheets = (doc: Document) =>
  [...doc.querySelectorAll('style')].map((style) => style.textContent).join('\n')
const placeholder = (root: HTMLElement) => root.querySelector('.animate-pulse')

beforeEach(() => {
  window.__ = (message: string) => message
  resizer.reportReady = () => {}
  theme.value = 'light'
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

  it('keeps every cell of a table quoted in a reply, with its borders', async () => {
    const root = mount(fixture('bordered-table-in-quote'))
    await nextTick()

    const table = rendered(root).querySelector('table')!
    const rows = [...table.querySelectorAll('tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent!.trim()),
    )
    expect(rows).toEqual([
      ['Ticket size', 'Upon registration', 'Upon auto-debit'],
      ['If amount is < INR 250', '₹ 5.00', '₹ 5.00'],
      ['INR 250 - INR 1000', '₹ 6.00', '₹ 7.00'],
      ['If amount is > INR 1000', '₹ 8.00', '₹ 18.00'],
    ])
    expect(table.getAttribute('border')).toBe('1')
    expect(table.querySelector('td')!.getAttribute('style')).toContain('border: 1px solid #000000')
  })

  it("keeps a code block's lines", async () => {
    const root = mount(fixture('code-in-notification'))
    await nextTick()

    expect(rendered(root).querySelector('pre')!.textContent).toBe(
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
    const adapted = vi.fn()
    const root = mount(fixture('dark-scheme-rules'), { onAdapted: adapted })
    await nextTick()

    expect(adapted).toHaveBeenLastCalledWith(true)
    expect(stylesheets(rendered(root))).not.toContain('background-color: #ffffff')
  })

  it('shows an adapted message as sent: every colour as written, on a light canvas', async () => {
    theme.value = 'dark'
    const adapted = vi.fn()
    const root = mount(fixture('dark-scheme-rules'), { asSent: true, onAdapted: adapted })
    await nextTick()

    const doc = rendered(root)
    expect(adapted).toHaveBeenLastCalledWith(true)
    expect(doc.querySelector('meta[name="color-scheme"]')!.getAttribute('content')).toBe('light')
    expect(stylesheets(doc)).toContain('.card { background-color: #ffffff; color: #1f2328; }')
    expect(stylesheets(doc)).toMatch(/body \{[^}]*background-color: #FFFFFF/)
    expect(doc.querySelector('.card')!.getAttribute('style')).toContain('#d1d9e0')
    expect(doc.body.innerHTML).toContain('color: #cf222e')
  })

  it('in the light theme adapts nothing, so there is nothing to show as sent', async () => {
    const adapted = vi.fn()
    mount(fixture('dark-scheme-rules'), { onAdapted: adapted })
    await nextTick()

    expect(adapted).toHaveBeenLastCalledWith(false)
  })
})
