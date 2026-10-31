import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'

import ChatPanel from './ChatPanel.vue'

vi.mock('./CreatePollModal.vue', () => ({ default: { render: () => null } }))
vi.mock('./PollMessageCard.vue', () => ({ default: { render: () => null } }))
vi.mock('./MeetAvatar.vue', () => ({ default: { render: () => null } }))
vi.mock('frappe-ui', () => ({
  Button: { render: () => h('button') },
  Dropdown: { render: () => null },
}))

let cleanup: () => void
afterEach(() => cleanup?.())
it.each([false, true])(
  'focuses on opening and reopening without stealing focus on messages or other updates (initially open: %s)',
  async (initiallyOpen) => {
    const props = reactive({
      open: initiallyOpen,
      userName: 'Alex',
      messages: [] as {
        id: string
        user_id: string
        user_name: string
        message: string
        timestamp: string
      }[],
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
