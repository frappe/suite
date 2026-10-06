import { computed, readonly, ref, type Ref } from 'vue'

import { transport as defaultTransport, type Transport } from '@/platform/transport'
import { api } from '@/platform/transport/api'

export type SessionStatus = 'loading' | 'guest' | 'authenticated'

export interface SessionUser {
  id: string
  fullName: string
  avatar: string | null
  email?: string
  [key: string]: unknown
}

export interface SessionCapabilities {
  jmap: boolean
  systemManager: boolean
}

export type PlatformCapability = keyof SessionCapabilities

export interface Session {
  status: Readonly<Ref<SessionStatus>>
  user: Readonly<Ref<SessionUser | null>>
  capabilities: Readonly<Ref<SessionCapabilities>>
  login(email: string, password: string): Promise<void>
  /** Ends the server session, then runs every logout cleanup before it resolves. */
  logout(): Promise<void>
  refresh(): Promise<void>
  /** Clears an expired local identity before another account can reuse cached state. */
  expire(): void
  /**
   * Runs `cleanup` on every later logout, after the server ends the session.
   * Use it for data a browser keeps per user, so the next user never sees it.
   * With `whileSignedIn`, it runs before the server ends the session, for a
   * cleanup that needs the user's session (a server-side unsubscribe).
   * A cleanup that fails does not stop the logout. Returns a function that
   * removes the cleanup.
   */
  onLogout(cleanup: () => Promise<void> | void, options?: { whileSignedIn?: boolean }): () => void
}

type AccountResponse = Record<string, unknown> & {
  name?: string
  id?: string
  email?: string
  full_name?: string
  fullName?: string
  avatar?: string | null
  user_image?: string | null
  roles?: string[] | { system_manager?: boolean }
  is_jmap_configured?: boolean
  capabilities?: Partial<SessionCapabilities>
}

export const ACCOUNT_REQUEST_PATH = '/api/suite/account'
// Composition installs the shared account reader after the identity bootstrap.
let accountReader: (() => Promise<AccountResponse | null>) | undefined
export function registerAccountReader(reader: () => Promise<AccountResponse | null>): void {
  accountReader = reader
}

export function createSession(client: Transport = defaultTransport): Session {
  const cookies = readCookies()
  const cookieId = sessionIdFromCookies(cookies)
  const status = ref<SessionStatus>(cookieId ? 'loading' : 'guest')
  const user = ref<SessionUser | null>(cookieId ? cookieUser(cookieId, cookies) : null)
  // The account route is the only source of capabilities [T021]. The
  // `system_user` cookie marks nearly every invited user, so boot grants none.
  const capabilities = ref<SessionCapabilities>({ jmap: false, systemManager: false })
  let refreshPromise: Promise<void> | null = null
  let generation = 0
  const logoutCleanups = new Set<() => Promise<void> | void>()
  const signedInLogoutCleanups = new Set<() => Promise<void> | void>()

  async function refresh(): Promise<void> {
    if (refreshPromise) return refreshPromise
    if (!sessionIdFromCookies(readCookies()) && !user.value) {
      status.value = 'guest'
      return
    }
    status.value = 'loading'
    const refreshGeneration = generation
    const read: Promise<AccountResponse | null> =
      client === defaultTransport && accountReader
        ? accountReader()
        : client.request(api.account.get, {})
    refreshPromise = read
      .then((account) => {
        if (refreshGeneration !== generation) return
        if (!account) {
          user.value = null
          capabilities.value = { jmap: false, systemManager: false }
          status.value = 'guest'
          return
        }
        const id =
          string(account.id) ?? string(account.name) ?? string(account.email) ?? user.value?.id
        if (!id || id === 'Guest') {
          user.value = null
          capabilities.value = { jmap: false, systemManager: false }
          status.value = 'guest'
          return
        }
        user.value = {
          ...account,
          id,
          email: string(account.email) ?? id,
          fullName:
            string(account.fullName) ?? string(account.full_name) ?? user.value?.fullName ?? id,
          avatar:
            string(account.avatar) ?? string(account.user_image) ?? user.value?.avatar ?? null,
        }
        capabilities.value = {
          jmap: account.capabilities?.jmap ?? !!account.is_jmap_configured,
          systemManager:
            account.capabilities?.systemManager ??
            (Array.isArray(account.roles)
              ? account.roles.includes('System Manager')
              : !!account.roles?.system_manager),
        }
        status.value = 'authenticated'
      })
      .catch(() => {
        if (refreshGeneration !== generation) return
        status.value = user.value ? 'authenticated' : 'guest'
      })
      .finally(() => {
        if (refreshGeneration === generation) refreshPromise = null
      })
    return refreshPromise
  }

  function expire(): void {
    generation += 1
    refreshPromise = null
    user.value = null
    capabilities.value = { jmap: false, systemManager: false }
    status.value = 'guest'
  }

  async function login(email: string, password: string): Promise<void> {
    expire()
    await client.request(api.auth.login, { usr: email, pwd: password })
    const cookiesAfterLogin = readCookies()
    const id = sessionIdFromCookies(cookiesAfterLogin) ?? email
    user.value = cookieUser(id, cookiesAfterLogin)
    status.value = 'loading'
    await refresh()
  }

  async function logout(): Promise<void> {
    await Promise.allSettled([...signedInLogoutCleanups].map(async (cleanup) => cleanup()))
    await client.request(api.auth.logout, {})
    await Promise.allSettled([...logoutCleanups].map(async (cleanup) => cleanup()))
    expire()
  }

  function onLogout(
    cleanup: () => Promise<void> | void,
    options: { whileSignedIn?: boolean } = {},
  ): () => void {
    const cleanups = options.whileSignedIn ? signedInLogoutCleanups : logoutCleanups
    cleanups.add(cleanup)
    return () => {
      cleanups.delete(cleanup)
    }
  }

  if (cookieId) void refresh()

  return {
    status: readonly(status),
    user: readonly(user),
    capabilities: readonly(capabilities),
    login,
    logout,
    refresh,
    expire,
    onLogout,
  }
}

const singleton = createSession()

export function useSession(): Session {
  return singleton
}

export function missingCapabilities(
  required: readonly PlatformCapability[] = [],
  session: Session = singleton,
): PlatformCapability[] {
  return required.filter((capability) => !session.capabilities.value[capability])
}

export function hasCapabilities(
  required: readonly PlatformCapability[] = [],
  session: Session = singleton,
): boolean {
  return missingCapabilities(required, session).length === 0
}

export const isAuthenticated = computed(() => singleton.status.value === 'authenticated')

export function getCookieSessionUser(): string | null {
  return sessionIdFromCookies(readCookies())
}

function readCookies(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  return Object.fromEntries(
    document.cookie
      .split('; ')
      .filter(Boolean)
      .map((entry) => {
        const [key, ...value] = entry.split('=')
        return [key, decodeURIComponent(value.join('='))]
      }),
  )
}

function sessionIdFromCookies(cookies: Record<string, string>): string | null {
  const id = cookies.user_id
  return id && id !== 'Guest' ? id : null
}

function cookieUser(id: string, cookies: Record<string, string>): SessionUser {
  return {
    id,
    email: id,
    fullName: cookies.full_name || id,
    avatar: cookies.user_image || null,
  }
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}
