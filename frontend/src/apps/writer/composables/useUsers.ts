import { shallowRef } from 'vue'

import { listUsers, type WriterUser } from '@/apps/writer/drive'
import { useSession } from '@/platform/session'

const users = shallowRef<WriterUser[]>([])
let loading: Promise<void> | null = null

function load(): void {
  if (loading || !useSession().user.value) return
  loading = listUsers()
    .then((rows) => {
      users.value = rows
    })
    .catch(() => {
      // Mentions and avatars fall back to the raw user id.
    })
}

/**
 * The site's people, loaded once per page load, for mentions and avatars.
 * Components that use `$user(...)` in templates alias `getUser` to `$user`.
 */
export function useUsers() {
  load()
  const getUser = (name: string) => users.value.find((user) => user.name === name)
  return { users, getUser }
}
