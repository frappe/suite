import { computed } from 'vue'

import { api, useMutation, useQuery } from '@/api'

/**
 * The unread notification count and the Mark all read action, shared by the
 * bell, the Notifications page and the phone tab. Marking reads refetch the
 * count everywhere (Drive's policy invalidates it).
 */
export function useUnreadNotifications() {
  const count = useQuery(api.drive.notifications.unreadCount, {})
  const markAll = useMutation(api.drive.notifications.markAllRead)
  const unread = computed(() => count.data?.unread ?? 0)

  async function markAllRead() {
    if (!unread.value) return
    await markAll.run({ all: true })
  }

  return { unread, markAllRead, markingAll: computed(() => markAll.isPending) }
}

/** The count as a badge shows it: at most "99+". */
export function unreadLabel(unread: number): string {
  return unread > 99 ? '99+' : String(unread)
}
