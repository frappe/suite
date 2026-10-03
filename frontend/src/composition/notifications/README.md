# Notifications

`NotificationsBell.vue` owns the rail popover. It reads Drive notifications and
reaches Drive navigation through the `@/apps/drive` package root only; the
operations themselves live in Drive's client (`apps/drive/client/notifications.ts`).
