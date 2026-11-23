import { beforeEach, describe, expect, it, vi } from 'vitest'

import { showMailReminder } from './reminders'

const { toastMessage } = vi.hoisted(() => ({ toastMessage: vi.fn() }))
vi.mock('frappe-ui', () => ({ toast: { message: toastMessage } }))

const reminder = { title: 'Back from snooze', body: 'Lease', path: '/mail/account/a/mailbox/i/t' }

const shown = vi.fn()
class FakeNotification {
  static permission = 'granted'
  onclick?: () => void
  close = vi.fn()
  constructor(title: string, options: { tag: string }) {
    shown(title, options.tag)
  }
}

const withPush = (subscribed: boolean) =>
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: async () => ({
        pushManager: { getSubscription: async () => (subscribed ? {} : null) },
      }),
    },
  })

describe('a reminder in the open tab', () => {
  beforeEach(() => {
    shown.mockClear()
    toastMessage.mockClear()
    vi.stubGlobal('Notification', FakeNotification)
  })

  it('always shows in the tab, with a way to open the mail', () => {
    withPush(true)
    const open = vi.fn()
    void showMailReminder(reminder, open)

    const [title, options] = toastMessage.mock.calls[0]
    expect(title).toBe('Back from snooze')
    expect(options.description).toBe('Lease')
    options.action.onClick()
    expect(open).toHaveBeenCalledWith(reminder.path)
  })

  it('leaves the OS notification to push when the device has it, so it does not alert twice', async () => {
    withPush(true)
    await showMailReminder(reminder, vi.fn())
    expect(shown).not.toHaveBeenCalled()
  })

  it('shows the OS notification itself when no push will come', async () => {
    withPush(false)
    await showMailReminder(reminder, vi.fn())
    expect(shown).toHaveBeenCalledWith('Back from snooze', reminder.path)
  })
})
