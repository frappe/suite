import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import EmojiPicker from '@/apps/mail/components/EmojiPicker.vue'
import { translationPlugin } from '@/platform/translation'

// Stands in for the popover: its trigger always, its content only while open.
vi.mock('frappe-ui', () => ({
  Button: defineComponent({
    setup(_, { attrs }) {
      return () => h('button', attrs, 'plus')
    },
  }),
  FormControl: defineComponent({
    setup() {
      return () => h('input', { 'data-search': '' })
    },
  }),
  Popover: defineComponent({
    props: { open: Boolean },
    emits: ['update:open'],
    setup(props, { slots, emit }) {
      const setOpen = (value: boolean) => emit('update:open', value)
      return () =>
        h('div', [
          slots.trigger?.({ open: props.open, setOpen }),
          props.open
            ? h('div', { 'data-content': '' }, slots.default?.({ close: () => setOpen(false) }))
            : null,
        ])
    },
  }),
}))

const pointer = (type: string, pointerType: string) =>
  Object.assign(new Event(type), { pointerType })

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  vi.useRealTimers()
})
beforeEach(() => vi.useFakeTimers())

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
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const trigger = () => root.querySelector<HTMLButtonElement>('[data-trigger]')!
  const palette = () => root.querySelector<HTMLElement>('[data-content] > div')
  const after = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms)
    await nextTick()
  }
  return { root, trigger, palette, after }
}

describe('EmojiPicker opening on hover', () => {
  it('opens when a mouse rests on the button', async () => {
    const { trigger, palette, after } = render(true)
    trigger().dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    expect(palette()).not.toBeNull()
  })

  it('does not open for a mouse just passing over', async () => {
    const { trigger, palette, after } = render(true)
    trigger().dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(50)
    trigger().dispatchEvent(pointer('pointerleave', 'mouse'))
    await after(1000)
    expect(palette()).toBeNull()
  })

  it('closes when the mouse leaves', async () => {
    const { trigger, palette, after } = render(true)
    trigger().dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    trigger().dispatchEvent(pointer('pointerleave', 'mouse'))
    await after(1000)
    expect(palette()).toBeNull()
  })

  it('stays open as the mouse crosses from the button to the palette', async () => {
    const { trigger, palette, after } = render(true)
    trigger().dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    trigger().dispatchEvent(pointer('pointerleave', 'mouse'))
    await after(50)
    palette()!.dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    expect(palette()).not.toBeNull()
  })

  it('stays open when clicked after hovering, rather than closing', async () => {
    const { trigger, palette, after } = render(true)
    trigger().dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    trigger().dispatchEvent(Object.assign(new Event('click'), { pointerType: 'mouse' }))
    await after(0)
    expect(palette()).not.toBeNull()
  })

  it('keeps the full list open when the mouse leaves it', async () => {
    const { root, trigger, after } = render(true)
    trigger().dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    root.querySelector<HTMLButtonElement>('[data-content] button:last-child')?.click()
    await after(0)
    expect(root.querySelector('[data-search]')).not.toBeNull()
    trigger().dispatchEvent(pointer('pointerleave', 'mouse'))
    await after(1000)
    expect(root.querySelector('[data-search]')).not.toBeNull()
  })

  it('opens on the short palette again after the full list was left open', async () => {
    const { root, trigger, palette, after } = render(true)
    trigger().dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    root.querySelector<HTMLButtonElement>('[data-content] button:last-child')?.click()
    await after(0)
    trigger().dispatchEvent(Object.assign(new Event('click'), { pointerType: 'touch' }))
    await after(0)
    expect(palette()).toBeNull()
    trigger().dispatchEvent(Object.assign(new Event('click'), { pointerType: 'touch' }))
    await after(0)
    expect(root.querySelector('[data-search]')).toBeNull()
  })

  it('leaves touch to tapping: a touch does not open it, and a tap toggles', async () => {
    const { trigger, palette, after } = render(true)
    trigger().dispatchEvent(pointer('pointerenter', 'touch'))
    await after(1000)
    expect(palette()).toBeNull()
    trigger().dispatchEvent(Object.assign(new Event('click'), { pointerType: 'touch' }))
    await after(0)
    expect(palette()).not.toBeNull()
    trigger().dispatchEvent(Object.assign(new Event('click'), { pointerType: 'touch' }))
    await after(0)
    expect(palette()).toBeNull()
  })
})

describe('EmojiPicker without it, as in the composer', () => {
  it('does not open on hover', async () => {
    const { trigger, root, after } = render(false)
    trigger().dispatchEvent(pointer('pointerenter', 'mouse'))
    await after(1000)
    expect(root.querySelector('[data-content]')).toBeNull()
  })

  it('still opens and closes on a click', async () => {
    const { trigger, root, after } = render(false)
    trigger().click()
    await after(0)
    expect(root.querySelector('[data-content]')).not.toBeNull()
    trigger().click()
    await after(0)
    expect(root.querySelector('[data-content]')).toBeNull()
  })
})
