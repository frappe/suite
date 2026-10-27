import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { openNotificationTarget, pushNotification } from '@/platform/pwa/notification'
import type { SessionStatus } from '@/platform/session'

// The FCM client talks to the relay, to Firebase and to Frappe. The fake keeps
// what the platform asks of it. Its token lives in localStorage, as the real
// client's does.
const TOKEN_KEY = 'firebase_token_mail'
const fcm = vi.hoisted(() => ({
  config: { projectId: 'suite-push', appId: '1:2:web:3' } as object | Error,
  initialized: [] as unknown[],
  handlers: [] as Array<(payload: object) => void>,
  calls: [] as string[],
  relayRequests: [] as string[],
  // The apps each client was made for, and the subscriptions it made for them.
  apps: [] as string[][],
}))
vi.mock('@/platform/pwa/frappe-push-notification', () => ({
  default: class {
    constructor(
      readonly projectName: string,
      readonly relayURL: string,
      readonly apps: string[],
    ) {
      fcm.apps.push(apps)
    }
    // The relay hears of the apps the token is not subscribed for yet.
    async syncApps() {
      fcm.calls.push(`subscribe ${localStorage.getItem('firebase_token_mail')} for ${this.apps}`)
    }
    async fetchWebConfig() {
      fcm.relayRequests.push(`${this.relayURL}/api/method/notification_relay.api.get_config`)
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
    // Notifications turned on here: a new token, subscribed.
    async enableNotification() {
      localStorage.setItem('firebase_token_mail', 'token-new')
      fcm.calls.push('subscribe token-new')
      return { permission_granted: true }
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
  sessionStorage.clear()
  fcm.config = { projectId: 'suite-push', appId: '1:2:web:3' }
  fcm.initialized = []
  fcm.handlers = []
  fcm.calls = []
  fcm.relayRequests = []
  fcm.apps = []
  window.push_relay_server_url = 'https://relay.test'
  showNotification = vi.fn(async () => {})
  register = vi.fn(async () => ({
    scope: 'http://suite.test/assets/suite/frontend/',
    showNotification,
  }))
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register },
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker')
  Reflect.deleteProperty(window, 'push_relay_server_url')
  vi.unstubAllGlobals()
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

// Mail and Calendar install from their own pages; the rest of Suite is the Suite.
const APPS = [
  { id: 'mail', scope: '/mail' },
  { id: 'calendar', scope: '/calendar' },
]
const path = ref('/home')

async function install(status: SessionStatus, user: string | null = 'a@suite.test') {
  const { installPwa } = await import('@/platform/pwa')
  const session = fakeSession(status, user)
  installPwa(session, { path: () => path.value, apps: APPS })
  await settle()
  return session
}

const linked = (rel: string) =>
  [...document.head.querySelectorAll(`link[rel="${rel}"]`)].map((link) => link.getAttribute('href'))

/** The browser's notification permission, answering `answer` when asked. */
function stubNotification(answer: NotificationPermission) {
  const requestPermission = vi.fn(async () => answer)
  vi.stubGlobal('Notification', { permission: 'default', requestPermission })
  return requestPermission
}

async function settle() {
  await nextTick()
  await vi.dynamicImportSettled()
  await new Promise((done) => setTimeout(done))
}

describe('Suite PWA', () => {
  it('links the Suite manifest outside the apps installed on their own', async () => {
    path.value = '/home'
    await install('guest')

    expect(linked('manifest')).toEqual(['/pwa/suite/manifest.webmanifest'])
    expect(linked('apple-touch-icon')).toEqual(['/pwa/suite/apple-icon-180.png'])
    expect(document.head.querySelector('meta[name="apple-mobile-web-app-capable"]')).not.toBeNull()
  })

  it("links an app's own manifest, icon and launch screens on its pages, and only its", async () => {
    path.value = '/mail/account/a/mailbox/inbox'
    await install('guest')
    expect(linked('manifest')).toEqual(['/pwa/mail/manifest.webmanifest'])
    expect(linked('apple-touch-icon')).toEqual(['/pwa/mail/apple-icon-180.png'])
    const launch = linked('apple-touch-startup-image')
    expect(launch.length).toBeGreaterThan(0)
    expect(launch.every((href) => href?.startsWith('/pwa/mail/splash/'))).toBe(true)

    path.value = '/calendar'
    await settle()
    expect(linked('manifest')).toEqual(['/pwa/calendar/manifest.webmanifest'])
    expect(linked('apple-touch-icon')).toEqual(['/pwa/calendar/apple-icon-180.png'])
    expect(document.head.querySelectorAll('meta[name="apple-mobile-web-app-capable"]').length).toBe(
      1,
    )

    path.value = '/files'
    await settle()
    expect(linked('manifest')).toEqual(['/pwa/suite/manifest.webmanifest'])
  })

  it('links only artwork that exists, for the Suite and each app', async () => {
    for (const app of ['suite', ...APPS.map(({ id }) => id)]) {
      path.value = app === 'suite' ? '/home' : `/${app}`
      document.head.innerHTML = ''
      vi.resetModules()
      await install('guest')
      for (const href of [...linked('apple-touch-icon'), ...linked('apple-touch-startup-image')]) {
        expect(existsSync(resolve(__dirname, `../../../public${href}`)), href!).toBe(true)
      }
    }
  })

  it('registers the push worker after sign-in, as Mail did, and starts FCM on that registration', async () => {
    const session = await install('guest')
    expect(register).not.toHaveBeenCalled()

    session.status.value = 'authenticated'
    await settle()

    const config = encodeURIComponent(JSON.stringify(fcm.config))
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(`${WORKER_URL}?config=${config}`, { type: 'module' })
    expect(fcm.relayRequests).toEqual([
      'https://relay.test/api/method/notification_relay.api.get_config',
    ])
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

  it.each([
    ['the site config has no relay', ''],
    ['the page has no boot, as on the Vite dev server', undefined],
  ])('asks no relay for push config and registers no worker when %s', async (_, relayURL) => {
    window.push_relay_server_url = relayURL
    await install('authenticated')

    expect(fcm.relayRequests).toEqual([])
    expect(register).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('shows one notification for a push that every open tab receives', async () => {
    // Two tabs: two pages, each with its own FCM client on the same worker.
    await install('authenticated')
    vi.resetModules()
    await install('authenticated')
    expect(fcm.handlers).toHaveLength(2)

    const push = {
      messageId: 'msg-1',
      data: { title: 'New mail', body: 'Hello', click_action: '/mail' },
    }
    for (const handler of fcm.handlers) handler(push)

    expect(showNotification).toHaveBeenCalledTimes(2)
    const tags = showNotification.mock.calls.map(
      ([, options]) => (options as NotificationOptions).tag,
    )
    // The same tag: the second notification replaces the first.
    expect(tags).toEqual(['msg-1', 'msg-1'])
    expect(showNotification).toHaveBeenCalledWith(
      'New mail',
      expect.objectContaining({ body: 'Hello' }),
    )
  })

  it('drops the push token on logout, so the next user in this browser gets none of the mail', async () => {
    localStorage.setItem(TOKEN_KEY, 'token-a')
    const session = await install('authenticated', 'a@suite.test')

    await session.logout()

    expect(fcm.calls).toEqual(['subscribe token-a for mail,calendar', 'unsubscribe token-a'])
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('subscribes a browser tab for every app, and an installed app for itself', async () => {
    localStorage.setItem(TOKEN_KEY, 'token-a')
    path.value = '/home'
    await install('authenticated', 'a@suite.test')
    expect(fcm.apps).toEqual([['mail', 'calendar']])

    // Calendar's own installed app: a session of its own.
    vi.resetModules()
    sessionStorage.clear()
    fcm.apps = []
    fcm.calls = []
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    path.value = '/calendar'
    await install('authenticated', 'a@suite.test')
    Reflect.deleteProperty(navigator, 'standalone')
    expect(fcm.apps).toEqual([['calendar']])
    expect(fcm.calls).toEqual(['subscribe token-a for calendar'])
  })

  it("keeps the one Suite app subscribed for every app, reloaded on another app's page", async () => {
    localStorage.setItem(TOKEN_KEY, 'token-a')
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    try {
      // The Suite app opens at its start URL.
      path.value = '/suite/start'
      await install('authenticated', 'a@suite.test')
      // Later in the same session it reloads on Calendar's page.
      vi.resetModules()
      fcm.apps = []
      path.value = '/calendar'
      await install('authenticated', 'a@suite.test')
      expect(fcm.apps).toEqual([['mail', 'calendar']])
    } finally {
      Reflect.deleteProperty(navigator, 'standalone')
    }
  })

  it("drops another user's token at sign-in when the logout did not go through the platform", async () => {
    localStorage.setItem(TOKEN_KEY, 'token-a')
    await install('authenticated', 'a@suite.test')
    // A's token is A's: it is kept, and subscribed for every app.
    expect(fcm.calls).toEqual(['subscribe token-a for mail,calendar'])

    // User A leaves through a logout that runs no platform cleanup; user B signs in.
    vi.resetModules()
    fcm.calls = []
    await install('authenticated', 'b@suite.test')

    expect(fcm.calls).toEqual(['forget token-a'])
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('asks for permission from the tap, before the push worker is ready', async () => {
    const requestPermission = stubNotification('granted')
    let ready!: () => void
    register.mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = () => resolve({ scope: 'http://suite.test/', showNotification })
        }),
    )
    await install('authenticated', 'a@suite.test')
    const { useDevicePush } = await import('@/platform/pwa')

    const turningOn = useDevicePush().enable()
    expect(requestPermission).toHaveBeenCalled()
    ready()
    expect(await turningOn).toBe(true)
  })

  it('says the browser refused only when it did, and a failed setup as that', async () => {
    stubNotification('denied')
    await install('authenticated', 'a@suite.test')
    const { useDevicePush } = await import('@/platform/pwa')
    expect(await useDevicePush().enable()).toBe(false)

    vi.resetModules()
    stubNotification('granted')
    register.mockRejectedValue(new Error('no worker'))
    await install('authenticated', 'a@suite.test')
    const fresh = await import('@/platform/pwa')
    await expect(fresh.useDevicePush().enable()).rejects.toThrow(
      'Notifications could not be set up on this device.',
    )
  })

  it('drops a token turned on in this browser when the next user signs in', async () => {
    stubNotification('granted')
    await install('authenticated', 'a@suite.test')
    const { useDevicePush } = await import('@/platform/pwa')
    expect(await useDevicePush().enable()).toBe(true)

    // User A leaves through a logout that runs no platform cleanup; user B signs in.
    vi.resetModules()
    fcm.calls = []
    await install('authenticated', 'b@suite.test')

    expect(fcm.calls).toEqual(['forget token-new'])
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it.each([
    ['mail', 'Frappe Mail'],
    ['calendar', 'Frappe Calendar'],
  ])('ships %s a manifest of its own, kept to its own pages', (app, name) => {
    const dir = resolve(__dirname, `../../../public/pwa/${app}`)
    const manifest = JSON.parse(readFileSync(`${dir}/manifest.webmanifest`, 'utf8')) as {
      icons: Array<{ src: string }>
    } & Record<string, unknown>

    expect(manifest).toMatchObject({
      id: `/${app}`,
      name,
      start_url: `/${app}`,
      scope: `/${app}`,
      display: 'standalone',
      handle_links: 'preferred',
    })
    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const icon of manifest.icons) expect(existsSync(`${dir}/${icon.src}`), icon.src).toBe(true)
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

describe('moving between apps on an iPhone', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  const PIXEL =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'

  const loadAt = async (at: string, userAgent: string, standalone = false) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: standalone })
    path.value = at
    await install('guest')
    return (await import('@/platform/pwa')).pageLoadNeededFor
  }
  afterEach(() => Reflect.deleteProperty(navigator, 'standalone'))

  it('loads the page afresh when the browser would install another app', async () => {
    const needed = await loadAt('/home', IPHONE)
    expect(needed('/mail/account/a/mailbox/inbox')).toBe(true)
    expect(needed('/calendar')).toBe(true)
    // Still the Suite's pages: the manifest the page loaded with is the right one.
    expect(needed('/drive')).toBe(false)
  })

  it('stays in place inside the app the page loaded in', async () => {
    const needed = await loadAt('/mail', IPHONE)
    expect(needed('/mail/account/a/mailbox/sent')).toBe(false)
    expect(needed('/home')).toBe(true)
  })

  it('stays in place where the browser follows the link, or in an installed app', async () => {
    expect((await loadAt('/home', PIXEL))('/mail')).toBe(false)
    vi.resetModules()
    document.head.innerHTML = ''
    expect((await loadAt('/home', IPHONE, true))('/mail')).toBe(false)
  })
})

describe('push notification click', () => {
  const origin = 'https://suite.test'
  const clientsWith = (urls: string[]) => {
    const windows = urls.map((url) => ({ url, focus: vi.fn(async () => {}) }))
    return { windows, matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => null) }
  }

  it('gives every browser the target in the notification data, not only Chrome', () => {
    const [, options] = pushNotification({
      data: { title: 'New mail', click_action: '/mail/inbox' },
    })
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
