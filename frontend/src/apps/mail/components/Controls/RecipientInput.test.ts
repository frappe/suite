import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue'

import type { DraftRecipient } from '@/apps/mail/types'
import type { RecipientField } from '@/apps/mail/utils/recipientFields'

import RecipientInput from './RecipientInput.vue'

// Whether the field believes it is on a phone — chips look and behave a little differently there,
// so each test says which it is before mounting.
const isMobile = vi.hoisted(() => ({ value: true }))
// The address book's answer to whatever is typed.
const suggested = vi.hoisted<{
  value: { email: string; name?: string; user_image?: string }[]
}>(() => ({ value: [] }))

vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    // Marks the element it stands for: the chips carry one, the menu's header carries one,
    // and telling the two apart is how a test finds a chip.
    Avatar: defineComponent({
      inheritAttrs: false,
      setup(_props, { attrs }) {
        return () => h('span', { 'data-avatar': attrs.label })
      },
    }),
    // Only the input matters here — the field focuses it, and the component reads the typed
    // text off its own model rather than the DOM.
    Combobox: defineComponent({
      inheritAttrs: false,
      emits: ['update:query'],
      setup(_props, { attrs, emit }) {
        // The field's own key handlers land on the input, as they do on the real one.
        const keys = () =>
          Object.fromEntries(Object.entries(attrs).filter(([name]) => name.startsWith('onKeydown')))
        return () =>
          h('input', {
            ...keys(),
            onInput: (e: Event) => {
              if (e.target instanceof HTMLInputElement) emit('update:query', e.target.value)
            },
          })
      },
    }),
    // Renders nothing while closed, and the menu's contents while open — which is all the
    // anchoring and dismissal behaviour a test can see.
    Popover: defineComponent({
      inheritAttrs: false,
      setup(_props, { attrs, slots }) {
        return () => (attrs.open ? h('div', { 'data-menu': '' }, slots.default?.()) : null)
      },
    }),
    toast: { error: vi.fn(), success: vi.fn() },
  }
})
vi.mock('@vueuse/core', async (original) => ({
  ...(await original<typeof import('@vueuse/core')>()),
  onClickOutside: () => {},
  useResizeObserver: () => {},
  useDebounceFn: (fn: unknown) => fn,
}))
vi.mock('@/api', async (original) => ({
  ...(await original<typeof import('@/api')>()),
  useQuery: () => ({
    get data() {
      return suggested.value
    },
    isFetching: false,
    error: null,
  }),
}))
vi.mock('@/apps/mail/utils/composables', async () => {
  const { computed } = await import('vue')
  return { useScreenSize: () => ({ isMobile: computed(() => isMobile.value) }) }
})
vi.mock('@/apps/mail/utils/accountScope', async () => {
  const { ref } = await import('vue')
  return { injectAccountScope: () => ({ accountId: ref('oa') }) }
})

const amy: DraftRecipient = { email: 'amy@example.com', display_name: 'Amy Diaz' }
const bo: DraftRecipient = { email: 'bo@example.com', display_name: 'Bo Chen' }

const mounted: App[] = []

/**
 * Dispatch a step later than anything before it. Vue skips a listener for an event stamped no later
 * than the millisecond the listener was attached, and mounting, typing and a key press can all land
 * inside one; the clock is frozen in `beforeEach` and moved on here, so none of them does.
 */
const fire = (target: EventTarget | null | undefined, event: Event) => {
  vi.setSystemTime(Date.now() + 1)
  target?.dispatchEvent(event)
}

function mount(
  recipients: DraftRecipient[],
  field: RecipientField = 'to',
  suggestionsTo: HTMLElement | null = null,
) {
  const model = ref<DraftRecipient[]>([...recipients])
  const moves: [string, RecipientField, RecipientField][] = []
  const revealedCcBcc = vi.fn()

  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(
    defineComponent({
      render: () =>
        h(RecipientInput, {
          field,
          modelValue: model.value,
          'onUpdate:modelValue': (value: DraftRecipient[]) => (model.value = value),
          onMove: (recipient: DraftRecipient, from: RecipientField, to: RecipientField) =>
            moves.push([recipient.email, from, to]),
          onShowCcBcc: revealedCcBcc,
          suggestionsTo,
        }),
    }),
  )
  app.config.globalProperties.__ = window.__
  app.mount(root)
  mounted.push(app)
  return { app, root, model, moves, revealedCcBcc }
}

/** The recipient chips: the buttons carrying an avatar. The menu's header has one too, but no button. */
const chips = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].filter((b) => b.querySelector('[data-avatar]'))

const menu = (root: HTMLElement) => root.querySelector('[data-menu]')

const menuItem = (root: HTMLElement, label: string) =>
  [...(menu(root)?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent?.trim() === label,
  ) ?? null

/** A tap on a chip, close enough: the row expands on the click before it. */
const tapChip = async (root: HTMLElement, index: number) => {
  fire(root.querySelector('[data-recipient-input]'), new MouseEvent('click', { bubbles: true }))
  await nextTick()
  fire(chips(root)[index], new MouseEvent('click', { bubbles: true }))
  await nextTick()
}

// jsdom lays nothing out, so it has no scrollIntoView; the stub records which element asked.
const scrollIntoView = vi.fn()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  scrollIntoView.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView
  window.__ = (message: string, args?: string[]) =>
    args ? message.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]) : message
  isMobile.value = true
  suggested.value = []
  document.body.innerHTML = ''
})

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  vi.useRealTimers()
})

describe('RecipientInput chip menu', () => {
  it('opens on the chip that was tapped, and says which address that is', async () => {
    const { root } = mount([amy, bo])
    expect(menu(root)).toBeNull()

    await tapChip(root, 1)

    expect(menu(root)?.textContent).toContain('Bo Chen')
    expect(menu(root)?.textContent).toContain('bo@example.com')
    expect(menu(root)?.textContent).not.toContain('amy@example.com')
  })

  it('re-addresses that recipient, and asks for the field it lands in to be shown', async () => {
    const { root, moves, revealedCcBcc } = mount([amy, bo])
    await tapChip(root, 1)

    menuItem(root, 'Move to Bcc')!.click()
    await nextTick()

    expect(moves).toEqual([['bo@example.com', 'to', 'bcc']])
    expect(revealedCcBcc).toHaveBeenCalled()
    // The move belongs to the draft, so the field itself lets both recipients stand.
    expect(chips(root)).toHaveLength(2)
    expect(menu(root)).toBeNull()
  })

  it('offers every field but the one the chip is already in', async () => {
    const { root } = mount([amy], 'cc')
    await tapChip(root, 0)

    expect(menuItem(root, 'Move to To')).not.toBeNull()
    expect(menuItem(root, 'Move to Bcc')).not.toBeNull()
    expect(menuItem(root, 'Move to Cc')).toBeNull()
  })

  it('takes the recipient off the mail on Remove, which the field does itself', async () => {
    const { root, model, moves } = mount([amy, bo])
    await tapChip(root, 0)

    menuItem(root, 'Remove')!.click()
    await nextTick()

    expect(model.value.map((r) => r.email)).toEqual(['bo@example.com'])
    expect(moves).toEqual([])
    expect(menu(root)).toBeNull()
  })

  it('carries no ✕ on a chip: Remove is in the menu the chip opens', async () => {
    const { root } = mount([amy])
    await nextTick()

    expect(chips(root)[0].querySelector('svg')).toBeNull()
  })
})

describe('RecipientInput chips on desktop', () => {
  beforeEach(() => {
    isMobile.value = false
  })

  it('keeps the ✕, which takes the recipient off the mail', async () => {
    const { root, model } = mount([amy, bo])
    await nextTick()

    const remove = chips(root)[0].querySelector<HTMLElement>('[aria-label^="Remove"]')
    expect(remove).not.toBeNull()

    fire(remove, new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(model.value.map((r) => r.email)).toEqual(['bo@example.com'])
  })

  it('opens the menu on a click too, naming the full address the chip shows only a name for', async () => {
    const { root } = mount([amy, bo])
    await tapChip(root, 1)

    expect(menu(root)?.textContent).toContain('bo@example.com')
    expect(menuItem(root, 'Move to Cc')).not.toBeNull()
  })
})

describe('RecipientInput suggestions in the page', () => {
  const samAtWork = { email: 'sam@work.example', name: 'Sam Rao' }
  const samAtHome = { email: 'sam@home.example', name: 'Sam Rao' }
  const sasha = { email: 'sasha@work.example', name: 'Sasha Iyer' }

  const typeInto = async (root: HTMLElement, text: string) => {
    fire(root.querySelector('[data-recipient-input]'), new MouseEvent('click', { bubbles: true }))
    const input = root.querySelector('input')!
    input.value = text
    fire(input, new Event('input', { bubbles: true }))
    await nextTick()
    await nextTick()
    return input
  }
  const press = async (input: HTMLInputElement, key: string, isComposing = false) => {
    fire(input, new KeyboardEvent('keydown', { key, isComposing, bubbles: true, cancelable: true }))
    await nextTick()
  }
  const options = (list: HTMLElement) => [...list.querySelectorAll('[role="option"]')]

  it('puts the weight on the domain where two suggestions share a name', async () => {
    isMobile.value = false
    suggested.value = [samAtWork, samAtHome, sasha]
    const list = document.createElement('div')
    document.body.appendChild(list)
    const { root } = mount([], 'to', list)
    await typeInto(root, 'sa')

    const domains = options(list).map((option) =>
      [...option.querySelectorAll('span')].flatMap((span) =>
        span.textContent?.startsWith('@') ? [span.className.includes('text-ink-gray-8')] : [],
      ),
    )
    expect(domains).toEqual([[true], [true], []])
  })

  it('walks the suggestions with the arrow keys, and Enter adds the one it is on', async () => {
    isMobile.value = false
    suggested.value = [samAtWork, samAtHome, sasha]
    const list = document.createElement('div')
    document.body.appendChild(list)
    const { root, model } = mount([], 'to', list)
    const input = await typeInto(root, 'sa')

    await press(input, 'ArrowDown')
    await press(input, 'ArrowDown')
    expect(options(list).map((o) => o.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ])

    await press(input, 'Enter')
    expect(model.value.map((r) => r.email)).toEqual(['sam@home.example'])
  })

  it('adds the first suggestion on Enter at a desk, as the floating list did', async () => {
    isMobile.value = false
    suggested.value = [sasha, samAtWork]
    const list = document.createElement('div')
    document.body.appendChild(list)
    const { root, model } = mount([], 'to', list)
    const input = await typeInto(root, 'sa')

    await press(input, 'Enter')
    expect(model.value.map((r) => r.email)).toEqual(['sasha@work.example'])
  })

  it('adds an address typed out in full on Enter, rather than a suggestion', async () => {
    isMobile.value = false
    suggested.value = [{ email: 'sam@work.example.org', name: 'Sam Rao' }]
    const list = document.createElement('div')
    document.body.appendChild(list)
    const { root, model } = mount([], 'to', list)
    const input = await typeInto(root, 'sam@work.example')

    await press(input, 'Enter')
    expect(model.value.map((r) => r.email)).toEqual(['sam@work.example'])
  })

  it('brings the row the arrow keys land on into view, so Enter never adds one out of sight', async () => {
    isMobile.value = false
    suggested.value = [samAtWork, samAtHome, sasha]
    const list = document.createElement('div')
    document.body.appendChild(list)
    const { root } = mount([], 'to', list)
    const input = await typeInto(root, 'sa')

    // Up from the start goes round to the last row, the one a short scroller cuts off.
    await press(input, 'ArrowUp')
    const scrolled = scrollIntoView.mock.contexts.at(-1)
    expect(scrolled).toBeInstanceOf(Element)
    expect(scrolled instanceof Element && scrolled.contains(options(list)[2])).toBe(true)
  })

  it('leaves the suggestions alone on the Enter that confirms an input method', async () => {
    isMobile.value = false
    suggested.value = [sasha, samAtWork]
    const list = document.createElement('div')
    document.body.appendChild(list)
    const { root, model } = mount([], 'to', list)
    const input = await typeInto(root, 'sa')

    await press(input, 'Enter', true)
    expect(model.value).toEqual([])
    expect(options(list)).toHaveLength(2)
  })

  it('puts the suggestions away on Esc, keeping it from the composer until they are gone', async () => {
    isMobile.value = false
    suggested.value = [sasha, samAtWork]
    const list = document.createElement('div')
    document.body.appendChild(list)
    const { root, model } = mount([], 'to', list)
    const input = await typeInto(root, 'sa')
    // The composer listens on the window: Esc there docks an expanded window.
    let composerEscapes = 0
    const composerEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') composerEscapes++
    }
    window.addEventListener('keydown', composerEsc)

    try {
      await press(input, 'Escape')
      expect(options(list)).toEqual([])
      expect(composerEscapes).toBe(0)
      expect(input.value).toBe('sa')

      // Enter adds nothing that is no longer on screen.
      await press(input, 'Enter')
      expect(model.value).toEqual([])

      await press(input, 'Escape')
      expect(composerEscapes).toBe(1)
    } finally {
      window.removeEventListener('keydown', composerEsc)
    }
  })
})
