import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionStatus } from '@/platform/session'
import { openNotificationTarget, pushNotification } from '@/platform/pwa/notification'

// The FCM client talks to the relay, to Firebase and to Frappe. The fake keeps
// what the platform asks of it. Its token lives in localStorage, as the real
// client's does.
const TOKEN_KEY = 'firebase_token_mail'
const fcm = vi.hoisted(() => ({
  config: { projectId: 'suite-push', appId: '1:2:web:3' } as object | Error,
  initialized: [] as unknown[],
  handlers: [] as Array<(payload: object) => void>,
  calls: [] as string[],
}))
vi.mock('@/platform/pwa/frappe-push-notification', () => ({
  default: class {
    constructor(readonly projectName: string) {}
    async fetchWebConfig() {
      if (fcm.config instanceof Error) throw fcm.config
      return fcm.config
    }
    onMessage(handler: (payload: object) => void) {
      fcm.handlers.push(handler)
    }
    async initialize(registration: unknown) {
      fcm.initialized.push(registration)
    }
    isNotificationEnabled() {
      return localStorage.getItem('firebase_token_mail') !== null
    }
    // Firebase and the server both drop the token.
    async disableNotification() {
      if (!this.isNotificationEnabled()) return
      fcm.calls.push(`unsubscribe ${localStorage.getItem('firebase_token_mail')}`)
      localStorage.removeItem('firebase_token_mail')
    }
    // Firebase drops the token; the server is not told.
    async forgetToken() {
      fcm.calls.push(`forget ${localStorage.getItem('firebase_token_mail')}`)
      localStorage.removeItem('firebase_token_mail')
    }
  },
}))

// The URL and options Mail's layout registered the worker with before stage 5.
// No `scope` option: the scope stays the default, `/assets/suite/frontend/`.
const WORKER_URL = '/assets/suite/frontend/sw.js'

let register: ReturnType<typeof vi.fn>
let showNotification: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  document.head.innerHTML = ''
  localStorage.clear()
  fcm.config = { projectId: 'suite-push', appId: '1:2:web:3' }
  fcm.initialized = []
  fcm.handlers = []
  fcm.calls = []
  showNotification = vi.fn(async () => {})
  register = vi.fn(async () => ({ scope: 'http://suite.test/assets/suite/frontend/', showNotification }))
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register },
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker')
  vi.restoreAllMocks()
})

/** A session double: status and user, and the logout that runs its cleanups the way the platform does. */
function fakeSession(status: SessionStatus, user: string | null) {
  const signedIn: Array<() => unknown> = []
  return {
    status: ref<SessionStatus>(status),
    user: ref(user ? { id: user, email: user, fullName: user, avatar: null } : null),
    onLogout(cleanup: () => unknown, options?: { whileSignedIn?: boolean }) {
      if (options?.whileSignedIn) signedIn.push(cleanup)
      return () => {}
    },
    async logout() {
      for (const cleanup of signedIn) await cleanup()
    },
  }
}

async function install(status: SessionStatus, user: string | null = 'a@suite.test') {
  const { installPwa } = await import('@/platform/pwa')
  const session = fakeSession(status, user)
  installPwa(session)
  await settle()
  return session
}

async function settle() {
  await nextTick()
  await vi.dynamicImportSettled()
  await new Promise((done) => setTimeout(done))
}

describe('Suite PWA', () => {
  it('links the Suite manifest once, whatever the route', async () => {
    await install('guest')
    const { setPwaTags } = await import('@/platform/pwa')
    setPwaTags()

    const manifests = document.head.querySelectorAll('link[rel="manifest"]')
    expect([...manifests].map((link) => link.getAttribute('href'))).toEqual([
      '/pwa/suite/manifest.webmanifest',
    ])
    expect(document.head.querySelector('meta[name="apple-mobile-web-app-capable"]')).not.toBeNull()
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')).not.toBeNull()
  })

  it('registers the push worker after sign-in, as Mail did, and starts FCM on that registration', async () => {
    const session = await install('guest')
    expect(register).not.toHaveBeenCalled()

    session.status.value = 'authenticated'
    await settle()

    const config = encodeURIComponent(JSON.stringify(fcm.config))
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(`${WORKER_URL}?config=${config}`, { type: 'module' })
    expect(fcm.initialized).toEqual([await register.mock.results[0]!.value])

    // A sign-out and a new sign-in in the same page do not register it twice.
    session.status.value = 'guest'
    await settle()
    session.status.value = 'authenticated'
    await settle()
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('still registers the worker without FCM when the relay config fails', async () => {
    fcm.config = new Error('relay down')
    await install('authenticated')

    expect(register).toHaveBeenCalledWith(WORKER_URL, { type: 'module' })
    expect(fcm.initialized).toEqual([])
  })

  it('shows one notification for a push that every open tab receives', async () => {
    // Two tabs: two pages, each with its own FCM client on the same worker.
    await install('authenticated')
    vi.resetModules()
    await install('authenticated')
    expect(fcm.handlers).toHaveLength(2)

    const push = { messageId: 'msg-1', data: { title: 'New mail', body: 'Hello', click_action: '/mail' } }
    for (const handler of fcm.handlers) handler(push)

    expect(showNotification).toHaveBeenCalledTimes(2)
    const tags = showNotification.mock.calls.map(([, options]) => (options as NotificationOptions).tag)
    // The same tag: the second notification replaces the first.
    expect(tags).toEqual(['msg-1', 'msg-1'])
    expect(showNotification).toHaveBeenCalledWith('New mail', expect.objectContaining({ body: 'Hello' }))
  })

  it('drops the push token on logout, so the next user in this browser gets none of the mail', async () => {
    localStorage.setItem(TOKEN_KEY, 'token-a')
    const session = await install('authenticated', 'a@suite.test')

    await session.logout()

    expect(fcm.calls).toEqual(['unsubscribe token-a'])
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it("drops another user's token at sign-in when the logout did not go through the platform", async () => {
    localStorage.setItem(TOKEN_KEY, 'token-a')
    await install('authenticated', 'a@suite.test')
    expect(fcm.calls).toEqual([])

    // User A leaves through a logout that runs no platform cleanup; user B signs in.
    vi.resetModules()
    await install('authenticated', 'b@suite.test')

    expect(fcm.calls).toEqual(['forget token-a'])
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('ships a manifest with the id /suite and the same start URL and scope', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../../../public/pwa/suite/manifest.webmanifest'), 'utf8'),
    ) as Record<string, unknown>

    expect(manifest).toMatchObject({
      id: '/suite',
      start_url: '/suite/start',
      scope: '/',
      name: 'Frappe Suite',
    })
  })
})

describe('push notification click', () => {
  const origin = 'https://suite.test'
  const clientsWith = (urls: string[]) => {
    const windows = urls.map((url) => ({ url, focus: vi.fn(async () => {}) }))
    return { windows, matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => null) }
  }

  it('gives every browser the target in the notification data, not only Chrome', () => {
    const [, options] = pushNotification({ data: { title: 'New mail', click_action: '/mail/inbox' } })
    expect(options.data).toEqual({ url: '/mail/inbox' })
  })

  it('focuses a Suite tab that already shows the target', async () => {
    const clients = clientsWith([`${origin}/home`, `${origin}/mail/inbox`])
    await openNotificationTarget(clients, origin, { url: '/mail/inbox' })
    expect(clients.windows[1]!.focus).toHaveBeenCalled()
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  it('opens the target when no tab shows it', async () => {
    const clients = clientsWith([`${origin}/home`])
    await openNotificationTarget(clients, origin, { url: '/mail/inbox' })
    expect(clients.openWindow).toHaveBeenCalledWith(`${origin}/mail/inbox`)
  })
})
