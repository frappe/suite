import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, reactive } from 'vue'

import MessageReactions from '@/apps/mail/components/MessageReactions.vue'
import { translationPlugin } from '@/platform/translation'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  undo: vi.fn(),
  raiseToast: vi.fn(() => 'toast-id'),
  setUndoAction: vi.fn(),
  retireUndoAction: vi.fn(),
}))

vi.mock('@/api', () => ({
  api: { mail: { messages: { react: 'react' }, scheduled: { undoReaction: 'undo' } } },
  useMutation: (reference: string) => ({ run: reference === 'react' ? mocks.send : mocks.undo }),
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: mocks.raiseToast }))
vi.mock('@/apps/mail/utils/composables', () => ({
  useOwnEmails: () => computed(() => new Set(['me@frappe.io'])),
  useUndo: () => ({ setUndoAction: mocks.setUndoAction, retireUndoAction: mocks.retireUndoAction }),
}))
vi.mock('frappe-ui', () => ({
  toast: { dismiss: vi.fn() },
  Button: defineComponent({
    props: { disabled: Boolean },
    setup(props, { slots, attrs }) {
      return () => h('button', { ...attrs, disabled: props.disabled }, slots.default?.())
    },
  }),
}))
// Stands in for the popover: a button per emoji offered, picking one setting the model.
vi.mock('@/apps/mail/components/EmojiPicker.vue', () => ({
  default: defineComponent({
    emits: ['update:modelValue'],
    setup(_, { emit }) {
      return () =>
        h('button', { 'data-pick': '🎉', onClick: () => emit('update:modelValue', '🎉') }, 'pick')
    },
  }),
}))

const mine = { emoji: '😂', from_name: 'Me', from_email: 'ME@frappe.io' }
const theirs = { emoji: '😍', from_name: 'Ana', from_email: 'ana@x.io' }

const flush = async () => {
  for (let i = 0; i < 5; i++) await nextTick()
}

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

function render(initial: Record<string, unknown> = {}) {
  const props = reactive<Record<string, unknown>>({ mailId: 'm1', account: 'acct', ...initial })
  const reload = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () =>
      h(MessageReactions, {
        ...props,
        onReload: reload,
      } as unknown as InstanceType<typeof MessageReactions>['$props']),
  })
  app.use(translationPlugin).mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const pick = () => root.querySelector<HTMLButtonElement>('[data-pick]')
  return {
    props,
    reload,
    pick,
    chipButtons: () => [...root.querySelectorAll<HTMLButtonElement>('button:not([data-pick])')],
    chips: () =>
      [...root.querySelectorAll('button:not([data-pick])')].map((chip) =>
        (chip.textContent ?? '').replace(/\s/g, ''),
      ),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.send.mockResolvedValue({ submission_id: 's1', undo_send_period: 5 })
  mocks.undo.mockResolvedValue(null)
})

describe('MessageReactions', () => {
  it('sends a picked emoji, shows it at once, and asks the thread to reload', async () => {
    const { pick, chips, reload } = render({ reactions: [theirs] })
    pick()!.click()
    await flush()
    expect(chips()).toContain('🎉1')
    expect(mocks.send).toHaveBeenCalledWith({ account: 'acct', id: 'm1', emoji: '🎉' })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('adds the reader to a chip someone else started', async () => {
    const { chipButtons } = render({ reactions: [theirs] })
    chipButtons()[0].click()
    await flush()
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ emoji: '😍' }))
  })

  it('sends nothing for a chip the reader is already in', async () => {
    const { chipButtons } = render({ reactions: [mine] })
    chipButtons()[0].click()
    await flush()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.raiseToast).toHaveBeenCalled()
  })

  it('takes the chip back when sending fails', async () => {
    mocks.send.mockRejectedValue(new Error('refused'))
    const { pick, chips } = render()
    pick()!.click()
    await flush()
    expect(chips().join()).not.toContain('🎉')
    expect(mocks.raiseToast).toHaveBeenCalledWith(expect.any(String), 'error')
  })

  it('does not count a sent reaction twice once the thread comes back with it', async () => {
    const { pick, chips, props } = render()
    pick()!.click()
    await flush()
    props.reactions = [{ emoji: '🎉', from_name: 'Me', from_email: 'me@frappe.io' }]
    await flush()
    expect(chips()).toEqual(['🎉1'])
  })

  it('offers Undo for what the server holds, which cancels it by its submission', async () => {
    const { pick, chips, reload } = render()
    pick()!.click()
    await flush()
    const undo = mocks.setUndoAction.mock.calls[0][0] as () => void
    undo()
    await flush()
    expect(chips().join()).not.toContain('🎉')
    expect(mocks.undo).toHaveBeenCalledWith({ account: 'acct', id: 's1' })
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('shows chips but offers no way to react in a read-only view', () => {
    const { pick, chipButtons } = render({ reactions: [theirs], readonly: true })
    expect(pick()).toBeNull()
    expect(chipButtons()[0].disabled).toBe(true)
  })

  it('renders nothing in a read-only view with no reactions', () => {
    expect(render({ readonly: true }).chipButtons()).toEqual([])
  })
})
