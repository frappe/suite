import { infinite, mutation, query } from '@/platform/server-state'

import { api } from './generated'
import { driveOperation } from './operation'

export interface DriveNotification {
  name: string
  read: number
  creation: string | null
  activity: { node: string; action: string; actor: string; at: string | null; detail: Record<string, unknown> }
}

const listOperation = driveOperation<
  { limit?: number; cursor?: string; unread?: boolean },
  { rows: DriveNotification[]; next_cursor: string | null }
>(api.notifications_list)
const countOperation = driveOperation<Record<string, never>, { unread: number }>(api.notifications_unread_count)
const readOperation = driveOperation<
  { notifications: string[] } | { all: true },
  { read: number }
>(api.notifications_read.notification_names, { looseInput: true })

export const notifications = (unread?: boolean) => infinite(listOperation, { limit: 60, unread })
export const unreadCount = () => query(countOperation, {}, { staleTime: 30_000 })
export const markNotificationsRead = () => mutation(readOperation, {
  invalidates: ['notifications_list', 'notifications_unread_count'],
})

