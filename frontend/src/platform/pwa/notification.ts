/**
 * How a push becomes a notification. The page (a push while a Suite tab is in
 * front) and Mail's service worker (a push in the background) both use it, so
 * a push looks and behaves the same either way.
 */

export interface PushPayload {
  messageId?: string
  data?: {
    title?: string
    body?: string
    notification_icon?: string
    click_action?: string | null
  }
}

/**
 * The title and options for one push. The tag is the FCM message id: every
 * open Suite tab receives a foreground push, and a notification with the same
 * tag replaces the one before it, so the user sees one.
 */
export function pushNotification(
  payload: PushPayload,
): [title: string, options: NotificationOptions] {
  const options: NotificationOptions = {
    body: payload.data?.body || '',
    badge: '/assets/suite/frontend/logo-96-96.png',
    data: { url: payload.data?.click_action || null },
  }
  if (payload.messageId) options.tag = payload.messageId
  if (payload.data?.notification_icon) options.icon = payload.data.notification_icon
  return [payload.data?.title || '', options]
}

/** Whether a notification's data comes from `pushNotification`. */
export function isSuitePushNotification(data: unknown): boolean {
  return typeof data === 'object' && data !== null && 'url' in data
}

interface WindowClientLike {
  url: string
  focus(): Promise<unknown>
}

interface ClientsLike {
  matchAll(options: {
    type: 'window'
    includeUncontrolled: boolean
  }): Promise<readonly WindowClientLike[]>
  openWindow(url: string): Promise<unknown>
}

/**
 * Opens the page a clicked notification points to: it focuses a Suite tab
 * that already shows it, or opens a new one. The worker controls no page, so
 * it cannot move an open tab to another URL.
 */
export async function openNotificationTarget(
  clients: ClientsLike,
  origin: string,
  data: unknown,
): Promise<void> {
  const target = (data as { url?: unknown } | null)?.url
  if (typeof target !== 'string' || !target) return
  const url = new URL(target, origin).href
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  const open = windows.find((client) => client.url === url)
  if (open) await open.focus()
  else await clients.openWindow(url)
}
