import { showReminderToast, showSystemReminder, type Reminder } from '@/platform/reminders'

/** A triggered event alert, as the server publishes it over the socket (`calendar_alert`). */
export type EventReminder = Reminder

/** Shows a reminder in the open tab. `open` takes the reader to the event. */
export function showEventReminder(reminder: EventReminder, open: (path: string) => void): void {
  // Both surfaces, deliberately: the toast is the in-app affordance, the system notification the one
  // the OS manages.
  showReminderToast(reminder, open)
  showSystemReminder(reminder, open, '/assets/suite/calendar/images/logo.png')
}

/**
 * Asks once for system notifications, the first time the user sets a
 * reminder — the moment they have just said they want to be told.
 */
export function requestAlertPermission(): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
  void Notification.requestPermission()
}
