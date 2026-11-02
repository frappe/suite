import { toast } from 'frappe-ui'
import { h } from 'vue'

import { translate as __ } from '@/platform/translation'

/**
 * A triggered event alert, as the server publishes it over the socket
 * (`calendar_alert`): the same title and line the device push carries, and
 * the in-app path to the event.
 */
export interface EventReminder {
  title: string
  body: string
  path: string
}

/** Shows a reminder in the open tab. `open` takes the reader to the event. */
export function showEventReminder(reminder: EventReminder, open: (path: string) => void): void {
  // Both surfaces, deliberately: the toast is the in-app affordance with an
  // Open action, the system notification is the one the OS manages — Do Not
  // Disturb, stacking, and (via the tag) deduping across open tabs.
  toast.message(reminder.title, {
    icon: () => h('span', { class: 'lucide-bell size-4' }),
    description: reminder.body,
    duration: 15_000,
    action: { label: __('Open'), onClick: () => open(reminder.path) },
  })
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const notification = new Notification(reminder.title, {
      body: reminder.body,
      tag: reminder.path,
      icon: '/assets/suite/calendar/images/logo.png',
    })
    notification.onclick = () => {
      window.focus()
      open(reminder.path)
      notification.close()
    }
  }
}

/**
 * Asks once for system notifications, the first time the user sets a
 * reminder — the moment they have just said they want to be told.
 */
export function requestAlertPermission(): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
  void Notification.requestPermission()
}
