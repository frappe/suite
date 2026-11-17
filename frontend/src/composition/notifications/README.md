# Notifications

`NotificationsList.vue` is the feed: its states, its rows, and what a tap on a
row does. Two surfaces show it: `NotificationsBell.vue`, the rail's popover,
and `NotificationsPage.vue`, the `/notifications` page that the phone bottom
bar's `NotificationsTab.vue` opens. `unread.ts` holds the unread count and Mark
all read for all three.

The list reads Drive notifications and reaches Drive navigation through the
`@/apps/drive` package root only; the operations themselves live in Drive's
client (`apps/drive/client/notifications.ts`).
