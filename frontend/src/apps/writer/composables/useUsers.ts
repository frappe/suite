import { allUsers } from '@/apps/drive/legacy/sdk'

/**
 * The suite main.ts does not set global properties, so components that use
 * `$user(...)` in templates import this composable and expose `getUser`
 * (aliased to `$user` in those components).
 */
export function useUsers() {
  const getUser = (name: string) =>
    allUsers.data?.find?.((k: { name: string }) => k.name === name)

  return { allUsers, getUser }
}
