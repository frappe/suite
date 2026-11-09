import { showReminderToast, showSystemReminder, type Reminder } from '@/platform/reminders'

const ICON = '/assets/suite/mail/frontend/manifest/manifest-icon-192.maskable.png'

// A device subscribed to push gets the server's notification already, tab open or not.
const pushReaches = async () => {
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  return !!(await registration?.pushManager?.getSubscription().catch(() => null))
}

/** Tells the reader in the open tab that mail has come back, and on the OS if nothing else will. */
export async function showMailReminder(reminder: Reminder, open: (path: string) => void) {
  showReminderToast(reminder, open)
  if (!(await pushReaches())) showSystemReminder(reminder, open, ICON)
}
