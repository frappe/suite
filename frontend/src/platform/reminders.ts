import { toast } from 'frappe-ui'
import { h } from 'vue'

import { translate as __ } from '@/platform/translation'

/**
 * Something the server wants the reader told about now, as it publishes it over the socket: the same
 * title and line the device push carries, and the in-app path to what it is about.
 */
export interface Reminder {
  title: string
  body: string
  path: string
}

/** The in-app affordance, with an Open action. `open` takes the reader to the path. */
export function showReminderToast(reminder: Reminder, open: (path: string) => void): void {
  toast.message(reminder.title, {
    icon: () => h('span', { class: 'lucide-bell size-4' }),
    description: reminder.body,
    duration: 15_000,
    action: { label: __('Open'), onClick: () => open(reminder.path) },
  })
}

/**
 * The notification the OS manages — Do Not Disturb, stacking, and (via the tag) deduping across open
 * tabs. Shown only if the reader has allowed them.
 */
export function showSystemReminder(
  reminder: Reminder,
  open: (path: string) => void,
  icon: string,
): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const notification = new Notification(reminder.title, {
    body: reminder.body,
    tag: reminder.path,
    icon,
  })
  notification.onclick = () => {
    window.focus()
    open(reminder.path)
    notification.close()
  }
}
