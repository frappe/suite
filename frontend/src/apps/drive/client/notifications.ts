import type { NotificationsListOutput } from './generated'

export type { NotificationsListOutput as NotificationsPage } from './generated'

export type DriveNotification = NotificationsListOutput['rows'][number]
