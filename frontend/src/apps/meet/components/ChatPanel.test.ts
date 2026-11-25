import { fromPartial } from '@total-typescript/shoehorn'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import ChatPanel from './ChatPanel.vue'

vi.mock('./ChatReactionPicker.vue', () => ({ default: { render: () => null } }))
vi.mock('./CreatePollModal.vue', () => ({ default: { render: () => null } }))
vi.mock('./PollMessageCard.vue', () => ({ default: { render: () => null } }))
vi.mock('./MeetAvatar.vue', () => ({ default: { render: () => null } }))
vi.mock('frappe-ui', () => ({
  Button: defineComponent({
    props: ['label'],
    setup:
      (props, { slots }) =>
      () =>
        h('button', { 'aria-label': props.label }, slots.default?.()),
  }),
  Dropdown: { render: () => null },
}))

let cleanup: () => void
afterEach(() => {
  cleanup?.()
  vi.restoreAllMocks()
})
it.each([false, true])(
  'focuses on opening and reopening without stealing focus on messages or other updates (initially open: %s)',
  async (initiallyOpen) => {
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus')
    const props = reactive({
      open: initiallyOpen,
      userName: 'Alex',
      messages: fromPartial<
        {
          id: string
          user_id: string
          user_name: string
          message: string
          timestamp: string
        }[]
      >([]),
    })
    const root = document.createElement('div')
    const elsewhere = document.createElement('button')
    document.body.append(root, elsewhere)
    const app = createApp({ setup: () => () => h(ChatPanel, props) })
    app.use(createPinia())
    app.mount(root)
    cleanup = () => {
      app.unmount()
      root.remove()
      elsewhere.remove()
    }
    if (initiallyOpen) {
      await nextTick()
      expect(document.activeElement).toBe(root.querySelector('textarea'))
    } else elsewhere.focus()
    props.open = true
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(root.querySelector('textarea'))
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
    elsewhere.focus()
    props.messages.push({
      id: 'new',
      user_id: 'other',
      user_name: 'Other',
      message: 'Hello',
      timestamp: new Date().toISOString(),
    })
    props.userName = 'Updated'
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(elsewhere)
    props.open = false
    await nextTick()
    props.open = true
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(root.querySelector('textarea'))
  },
)

it('sends a reply to the selected message and jumps from its quote to the original bubble', async () => {
  const sendMessage = vi.fn().mockResolvedValue(true)
  const original = {
    id: 'original',
    messageId: 'original',
    user_id: 'other',
    user_name: 'Beth',
    message: 'Can we move the review?',
    timestamp: '2026-11-25T14:00:00Z',
  }
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () =>
      h(ChatPanel, {
        open: true,
        userId: 'me',
        messages: [
          original,
          {
            ...original,
            id: 'reply',
            messageId: 'reply',
            user_id: 'me',
            user_name: 'Alex',
            message: 'Yes, 2 pm works.',
            replyTo: { messageId: 'original', fromName: 'Beth', message: original.message },
          },
        ],
        sendMessage,
        setReaction: vi.fn(),
        reactionsByMessage: {},
      }),
  })
  app.use(createPinia()).mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
    vi.unstubAllGlobals()
  }

  root
    .querySelector<HTMLButtonElement>('[data-message-id="original"] [aria-label="Reply"]')
    ?.click()
  await nextTick()
  expect(root.textContent).toContain('Replying to Beth')

  const textarea = root.querySelector('textarea')
  if (!textarea) throw new Error('Expected the chat composer to be available')
  textarea.value = 'I will send an invite.'
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
  expect(sendMessage).toHaveBeenCalledWith('I will send an invite.', 'original')
  await nextTick()
  await nextTick()
  expect(root.textContent).not.toContain('Replying to Beth')

  vi.stubGlobal('CSS', { escape: (id: string) => id })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const row = root.querySelector('[data-message-id="original"]')
  if (!row) throw new Error('Expected the original message to be visible')
  const scrollIntoView = vi.fn()
  Object.assign(row, { scrollIntoView })
  root.querySelector<HTMLButtonElement>('[data-message-id="reply"] .chat-quote')?.click()
  await nextTick()
  expect(document.activeElement).toBe(row)
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  expect(
    row.querySelector('.chat-message-bubble')?.classList.contains('chat-message-highlighted'),
  ).toBe(true)
})
