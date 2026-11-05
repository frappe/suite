import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import EmojiPicker from '@/apps/mail/components/EmojiPicker.vue'
import { translationPlugin } from '@/platform/translation'

// The real popover: its trigger toggles on a press by itself, which is what opening on hover has to
// work with. A stand-in without that passed while a tap did nothing at all.
vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../node_modules/frappe-ui/src/components/Popover')),
  Button: defineComponent({
    setup(_, { attrs }) {
      return () => h('button', { 'data-plus': '', ...attrs }, 'plus')
    },
  }),
  FormControl: defineComponent({
    setup() {
      return () => h('input', { 'data-search': '' })
    },
  }),
}))
vi.mock('gemoji', () => ({ gemoji: [] }))

const pointer = (type: string, pointerType: string) =>
  Object.assign(new Event(type, { bubbles: type === 'click' }), { pointerType })

const paletteIsOpen = () => document.body.textContent?.includes('🙏') ?? false
const fullListIsOpen = () => !!document.body.querySelector('[data-search]')

let cleanup: (() => void) | undefined
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup?.()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function render(openOnHover: boolean) {
  const shortPalette = ref(true)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () =>
      h(
        EmojiPicker,
        {
          openOnHover,
          reaction: shortPalette.value,
          'onUpdate:reaction': (value: boolean) => (shortPalette.value = value),
        },
        {
          default: ({
            press,
            hover,
            toggle,
          }: {
            press: (event: Event) => void
            hover: object
            toggle: () => void
          }) =>
            h('button', {
              'data-trigger': '',
              ...hover,
              onClick: (event: Event) => (openOnHover ? press(event) : toggle()),
            }),
        },
      ),
  })
  app.use(translationPlugin).mount(root)
  cleanup = () => app.unmount()
  const trigger = root.querySelector<HTMLButtonElement>('[data-trigger]')!
  const after = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 20; i++) await nextTick()
  }
  return { trigger, after }
}

describe('EmojiPicker opening on hover', () => {
  it('opens when a mouse rests on the button', async () => {
    const { trigger, after } = render(true)
    trigger.dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    expect(paletteIsOpen()).toBe(true)
  })

  it('does not open for a mouse just passing over', async () => {
    const { trigger, after } = render(true)
    trigger.dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(50)
    trigger.dispatchEvent(pointer('pointerleave', 'mouse'))
    await after(1000)
    expect(paletteIsOpen()).toBe(false)
  })

  it('closes when the mouse leaves', async () => {
    const { trigger, after } = render(true)
    trigger.dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    trigger.dispatchEvent(pointer('pointerleave', 'mouse'))
    await after(1000)
    expect(paletteIsOpen()).toBe(false)
  })

  it('stays open when clicked after hovering, rather than closing', async () => {
    const { trigger, after } = render(true)
    trigger.dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    trigger.dispatchEvent(pointer('click', 'mouse'))
    await after()
    expect(paletteIsOpen()).toBe(true)
  })

  it('opens on a click from a mouse that had not rested yet', async () => {
    const { trigger, after } = render(true)
    trigger.dispatchEvent(pointer('click', 'mouse'))
    await after()
    expect(paletteIsOpen()).toBe(true)
  })

  it('opens and closes on a tap, and a touch alone does not open it', async () => {
    const { trigger, after } = render(true)
    trigger.dispatchEvent(pointer('pointerenter', 'touch'))
    await after(1000)
    expect(paletteIsOpen()).toBe(false)
    trigger.dispatchEvent(pointer('click', 'touch'))
    await after()
    expect(paletteIsOpen()).toBe(true)
    trigger.dispatchEvent(pointer('click', 'touch'))
    await after()
    expect(paletteIsOpen()).toBe(false)
  })

  it('opens on a key press, which has no pointer type', async () => {
    const { trigger, after } = render(true)
    trigger.dispatchEvent(pointer('click', ''))
    await after()
    expect(paletteIsOpen()).toBe(true)
  })

  it('keeps the full list open when the mouse leaves it', async () => {
    const { trigger, after } = render(true)
    trigger.dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    document.body.querySelector<HTMLButtonElement>('[data-plus]')?.click()
    await after()
    expect(fullListIsOpen()).toBe(true)
    trigger.dispatchEvent(pointer('pointerleave', 'mouse'))
    await after(1000)
    expect(fullListIsOpen()).toBe(true)
  })

  it('opens on the short palette again after the full list', async () => {
    const { trigger, after } = render(true)
    trigger.dispatchEvent(pointer('click', 'touch'))
    await after()
    document.body.querySelector<HTMLButtonElement>('[data-plus]')?.click()
    await after()
    trigger.dispatchEvent(pointer('click', 'touch'))
    await after()
    trigger.dispatchEvent(pointer('click', 'touch'))
    await after()
    expect(paletteIsOpen()).toBe(true)
    expect(fullListIsOpen()).toBe(false)
  })
})

describe('EmojiPicker without it, as in the composer', () => {
  it('does not open on hover', async () => {
    const { trigger, after } = render(false)
    trigger.dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    expect(paletteIsOpen()).toBe(false)
  })

  it('still opens and closes on a click', async () => {
    const { trigger, after } = render(false)
    trigger.click()
    await after()
    expect(paletteIsOpen()).toBe(true)
    trigger.click()
    await after()
    expect(paletteIsOpen()).toBe(false)
  })
})
