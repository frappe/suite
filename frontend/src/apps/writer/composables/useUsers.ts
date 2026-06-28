import { allUsers } from '@/apps/drive/ui/drive/js/resources'

/**
 * Replacement for the standalone app's global `$user(name)` property.
 *
 * The standalone main.ts did:
 *   app.config.globalProperties.$user = (user) =>
 *     allUsers.data?.find((k) => k.name === user)
 *
 * The suite main.ts does not set global properties, so components that used
 * `$user(...)` in templates now import this composable and expose `getUser`
 * (aliased to `$user` in those components).
 */
export function useUsers() {
  const getUser = (name: string) =>
    allUsers.data?.find?.((k: { name: string }) => k.name === name)

  return { allUsers, getUser }
}
