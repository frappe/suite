import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h } from 'vue'

import MessageReactions from '@/apps/mail/components/MessageReactions.vue'
import type { MailReaction } from '@/apps/mail/types'
import { translationPlugin } from '@/platform/translation'

vi.mock('@/apps/mail/utils/composables', () => ({
  useOwnEmails: () => computed(() => new Set(['me@frappe.io'])),
}))
vi.mock('frappe-ui', () => ({
  Button: defineComponent({
    props: { disabled: Boolean },
    setup(props, { slots, attrs }) {
      return () => h('button', { ...attrs, disabled: props.disabled }, slots.default?.())
    },
  }),
  Tooltip: defineComponent({
    props: { text: String },
    setup(props, { slots }) {
      return () => h('div', { 'data-tooltip': props.text }, slots.default?.())
    },
  }),
}))
// Stands in for the popover: a button that picks one emoji.
vi.mock('@/apps/mail/components/ReactionPicker.vue', () => ({
  default: defineComponent({
    emits: ['pick'],
    setup(_, { emit }) {
      return () => h('button', { 'data-pick': '', onClick: () => emit('pick', '🎉') }, 'pick')
    },
  }),
}))

const theirs: MailReaction = { emoji: '😍', from_name: 'Ana', from_email: 'ana@x.io' }

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

function render(reactions: MailReaction[], readonly = false, refusal?: string) {
  const onReact = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h(MessageReactions, { reactions, readonly, refusal, onReact }),
  })
  app.use(translationPlugin).mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return {
    onReact,
    root,
    pick: root.querySelector<HTMLButtonElement>('[data-pick]'),
    chips: [...root.querySelectorAll<HTMLButtonElement>('button:not([data-pick])')],
  }
}

describe('MessageReactions', () => {
  it('takes up no room on a message with no reactions', () => {
    const { pick, chips } = render([])
    expect(pick).toBeNull()
    expect(chips).toEqual([])
  })

  it('counts the people behind each emoji', () => {
    const { chips } = render([theirs, { ...theirs, from_email: 'bo@x.io' }])
    expect(chips.map((chip) => chip.textContent?.replace(/\s/g, ''))).toEqual(['😍2'])
  })

  it('reacts with the emoji of the chip pressed', () => {
    const { chips, onReact } = render([theirs])
    chips[0].click()
    expect(onReact).toHaveBeenCalledWith('😍')
  })

  it('reacts with what is picked beside the chips', () => {
    const { pick, onReact } = render([theirs])
    pick?.click()
    expect(onReact).toHaveBeenCalledWith('🎉')
  })

  it('cannot be pressed on a message that cannot be reacted to, but still says who reacted', () => {
    const { chips, root, onReact } = render([theirs], false, 'A list.')
    expect(chips[0].disabled).toBe(true)
    chips[0].click()
    expect(onReact).not.toHaveBeenCalled()
    expect(root.querySelector('[data-tooltip]')?.getAttribute('data-tooltip')).toBe('Ana')
  })

  it('shows chips but offers no way to react in a read-only view', () => {
    const { pick, chips } = render([theirs], true)
    expect(pick).toBeNull()
    expect(chips[0].disabled).toBe(true)
  })
})
