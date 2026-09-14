import { computed, readonly, ref, type Ref } from 'vue'

import { transport as defaultTransport, type Operation, type Transport } from '@/platform/transport'

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
  logout(): Promise<void>
  refresh(): Promise<void>
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

// W1-backend-composition owns this route. Until it lands, a failed request keeps
// the synchronous cookie identity and adds no guessed profile data.
export const ACCOUNT_REQUEST_PATH = '/api/suite/account'

const accountOperation: Operation<Record<string, never>, AccountResponse> = {
  id: 'suite.account',
  owner: 'suite',
  method: 'GET',
  path: ACCOUNT_REQUEST_PATH,
}

const loginOperation: Operation<{ usr: string; pwd: string }, unknown> = {
  id: 'frappe.login',
  owner: 'suite',
  method: 'POST',
  path: '/api/v2/method/login',
}

const logoutOperation: Operation<Record<string, never>, unknown> = {
  id: 'frappe.logout',
  owner: 'suite',
  method: 'POST',
  path: '/api/v2/method/logout',
}

export function createSession(client: Transport = defaultTransport): Session {
  const cookies = readCookies()
  const cookieId = sessionIdFromCookies(cookies)
  const status = ref<SessionStatus>(cookieId ? 'loading' : 'guest')
  const user = ref<SessionUser | null>(cookieId ? cookieUser(cookieId, cookies) : null)
  const capabilities = ref<SessionCapabilities>({
    jmap: false,
    systemManager: cookies.system_user === 'yes',
  })
  let refreshPromise: Promise<void> | null = null

  async function refresh(): Promise<void> {
    if (refreshPromise) return refreshPromise
    if (!sessionIdFromCookies(readCookies()) && !user.value) {
      status.value = 'guest'
      return
    }
    status.value = 'loading'
    refreshPromise = client
      .request(accountOperation, {})
      .then((account) => {
        const id = string(account.id) ?? string(account.name) ?? string(account.email) ?? user.value?.id
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
          fullName: string(account.fullName) ?? string(account.full_name) ?? user.value?.fullName ?? id,
          avatar: string(account.avatar) ?? string(account.user_image) ?? user.value?.avatar ?? null,
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
        status.value = user.value ? 'authenticated' : 'guest'
      })
      .finally(() => {
        refreshPromise = null
      })
    return refreshPromise
  }

  async function login(email: string, password: string): Promise<void> {
    await client.request(loginOperation, { usr: email, pwd: password })
    const cookiesAfterLogin = readCookies()
    const id = sessionIdFromCookies(cookiesAfterLogin) ?? email
    user.value = cookieUser(id, cookiesAfterLogin)
    status.value = 'loading'
    await refresh()
  }

  async function logout(): Promise<void> {
    await client.request(logoutOperation, {})
    user.value = null
    capabilities.value = { jmap: false, systemManager: false }
    status.value = 'guest'
  }

  if (cookieId) void refresh()

  return {
    status: readonly(status),
    user: readonly(user),
    capabilities: readonly(capabilities),
    login,
    logout,
    refresh,
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
