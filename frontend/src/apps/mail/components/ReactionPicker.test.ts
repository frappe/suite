import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import ReactionPicker from '@/apps/mail/components/ReactionPicker.vue'
import { translationPlugin } from '@/platform/translation'

const raiseToast = vi.hoisted(() => vi.fn())

vi.mock('@/apps/mail/utils', () => ({ raiseToast }))
vi.mock('frappe-ui', () => ({
  Button: defineComponent({
    setup(_, { attrs }) {
      return () => h('button', attrs, 'button')
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
beforeEach(() => raiseToast.mockClear())

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

  it('says why when pressed on a message that cannot, with no palette to pick from', () => {
    const root = render('A list.')
    expect(root.querySelector('[data-palette]')).toBeNull()
    root.querySelector('button')?.click()
    expect(raiseToast).toHaveBeenCalledWith('A list.', 'error')
  })
})
