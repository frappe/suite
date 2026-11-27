import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import MessageReactions from '@/apps/mail/components/MessageReactions.vue'
import type { MailReaction } from '@/apps/mail/types'
import { translationPlugin } from '@/platform/translation'

const screen = vi.hoisted(() => ({ isMobile: { value: false } }))
vi.mock('@/apps/mail/utils/composables', async () => {
  const { ref } = await import('vue')
  screen.isMobile = ref(false)
  return { useScreenSize: () => screen }
})
vi.mock('frappe-ui', () => ({
  BottomSheet: defineComponent({
    props: { open: Boolean, title: String },
    setup(props, { slots }) {
      return () => props.open && h('section', { 'data-sheet': '' }, slots.default?.())
    },
  }),
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
afterEach(() => {
  cleanup?.()
  screen.isMobile.value = false
})

function render(reactions: MailReaction[], readonly = false, refusal?: string) {
  const onReact = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () =>
      h(MessageReactions, {
        reactions,
        ownEmails: new Set(['me@frappe.io']),
        readonly,
        refusal,
        onReact,
      }),
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
  it('offers adding the first reaction on a message with none', () => {
    const { pick, chips, onReact } = render([])
    expect(chips).toEqual([])
    pick?.click()
    expect(onReact).toHaveBeenCalledWith('🎉')
  })

  it('takes up no room in a read-only view of a message with none', () => {
    const { pick, chips } = render([], true)
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

  describe('on a phone', () => {
    const sheet = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-sheet]')
    const inSheet = (root: HTMLElement, text: string) =>
      [...(sheet(root)?.querySelectorAll('button') ?? [])].find(
        (b) => b.textContent?.trim() === text,
      )

    // A reaction goes out as mail, and a chip is easy to touch by accident while scrolling
    it('opens the sheet from a chip, saying who reacted, and sends nothing', async () => {
      screen.isMobile.value = true
      const { chips, root, onReact } = render([theirs])
      chips[0].click()
      await nextTick()
      expect(onReact).not.toHaveBeenCalled()
      expect(sheet(root)?.textContent).toContain('Ana')
    })

    it('reacts with an emoji picked in the sheet', async () => {
      screen.isMobile.value = true
      const { root, onReact } = render([])
      root.querySelector<HTMLButtonElement>('[aria-label="Reactions"]')?.click()
      await nextTick()
      inSheet(root, '👍')?.click()
      expect(onReact).toHaveBeenCalledWith('👍')
    })

    it('says who reacted in a read-only view, with nothing to react with', async () => {
      screen.isMobile.value = true
      const { chips, root } = render([theirs], true)
      chips[0].click()
      await nextTick()
      expect(sheet(root)?.textContent).toContain('Ana')
      expect(inSheet(root, '👍')).toBeUndefined()
    })
  })
})
