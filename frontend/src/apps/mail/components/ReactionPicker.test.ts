import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import ReactionPicker from '@/apps/mail/components/ReactionPicker.vue'
import { translationPlugin } from '@/platform/translation'

vi.mock('frappe-ui', () => ({
  Button: defineComponent({
    setup(_, { attrs }) {
      return () => h('button', attrs, 'button')
    },
  }),
  Tooltip: defineComponent({
    props: { text: String },
    setup(props, { slots }) {
      return () => h('div', { 'data-tooltip': props.text }, slots.default?.())
    },
  }),
}))
// Stands in for the popover: the palette, there to be seen or not.
vi.mock('@/apps/mail/components/EmojiPicker.vue', () => ({
  default: defineComponent({
    setup() {
      return () => h('div', { 'data-palette': '' })
    },
  }),
}))

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

function render(refusal?: string) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(ReactionPicker, { refusal }) })
  app.use(translationPlugin).mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root
}

describe('ReactionPicker', () => {
  it('offers the palette on a message that can be reacted to', () => {
    expect(render().querySelector('[data-palette]')).not.toBeNull()
  })

  it('cannot be pressed on a message that cannot be reacted to, and says why on hover', () => {
    const root = render('A list.')
    expect(root.querySelector('[data-palette]')).toBeNull()
    expect(root.querySelector('button')?.hasAttribute('disabled')).toBe(true)
    expect(root.querySelector('[data-tooltip]')?.getAttribute('data-tooltip')).toBe('A list.')
  })
})
