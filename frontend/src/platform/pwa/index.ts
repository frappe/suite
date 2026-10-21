import { readonly, shallowRef, watch } from 'vue'

import type { Session } from '@/platform/session'

import { pushNotification } from './notification'
import SPLASH_DEVICES from './splash-devices.json'

declare global {
  interface Window {
    /**
     * Notification relay server base URL, from the SPA boot (`suite/www/suite.py`).
     * `""` when the site config has none; missing on the Vite dev page, which has no boot.
     */
    push_relay_server_url?: string
  }
}

/**
 * The Suite PWA, and the apps installed from their own pages [T010, T018, ticket 047].
 *
 * - The manifest and the iOS install tags sit on every route, and follow it:
 *   a page of an installable app (Mail's, under `/mail`) links that app's, so
 *   installing from there installs the app; every other page links the
 *   Suite's, which stays at its address so installs of the Suite keep it.
 * - The push service worker registers once a user signs in, in every area and
 *   whether or not Mail, Calendar and Meet are in the shell. It is Mail's FCM
 *   worker (`src/apps/mail/sw.ts`, built to `sw.js`); its push handlers stay
 *   there. A site with no notification relay registers no worker: the worker
 *   only handles push, and its scope covers no Suite page.
 * - A push subscription belongs to one user. Logout drops it on the server
 *   and in the browser. A sign-in that finds another user's subscription (a
 *   logout that did not go through the platform session) drops it in the
 *   browser, so the next user never receives the last user's mail.
 */
export function installPwa(
  session: Pick<Session, 'status' | 'user' | 'onLogout'>,
  routes: PwaRoutes,
): void {
  installableApps = routes.apps
  watch(
    () => pwaAppAt(routes.path(), routes.apps),
    (app) => {
      loadedApp ??= app
      currentApp.value = app
      setPwaTags(app)
    },
    { immediate: true },
  )
  let client: Promise<PushClient | null> | null = null
  watch(
    session.status,
    (status) => {
      if (client || status !== 'authenticated') return
      client = registerPushServiceWorker(session.user.value?.id ?? null)
    },
    { immediate: true },
  )
  session.onLogout(
    async () => {
      const push = await client
      await push?.disableNotification()
      localStorage.removeItem(PUSH_OWNER_KEY)
    },
    { whileSignedIn: true },
  )
}

/**
 * An app installed from its own pages: they are the pages under `scope`, and
 * its manifest and artwork sit in `public/pwa/<id>/`.
 */
export interface InstallableApp {
  id: string
  scope: string
}

export interface PwaRoutes {
  /** The current route's path. Reactive. */
  path: () => string
  apps: readonly InstallableApp[]
}

const currentApp = shallowRef('suite')
let installableApps: readonly InstallableApp[] = []
// The app whose manifest the page linked when it loaded.
let loadedApp: string | null = null

/** The app whose manifest the page links now: an installable app's id, or `suite`. */
export const linkedPwaApp = readonly(currentApp)

/** The app a page installs as: the installable app it belongs to, or the Suite. */
export function pwaAppAt(path: string, apps: readonly InstallableApp[]): string {
  const app = apps.find(({ scope }) => path === scope || path.startsWith(`${scope}/`))
  return app?.id ?? 'suite'
}

/**
 * Whether opening `path` takes a fresh page load for the browser to install the right app. On an
 * iPhone or iPad the browser reads a page's manifest once, when the page loads, and keeps it
 * however the page changes its link: moved from Home to Mail in place, it would install the Suite
 * under Mail's icon. Every other browser follows the link, and an installed app installs nothing.
 */
export function pageLoadNeededFor(path: string): boolean {
  if (!loadedApp || !onIosBrowser()) return false
  return pwaAppAt(path, installableApps) !== loadedApp
}

/** Safari, or any browser on iOS (all are WebKit), outside an app on the home screen. */
function onIosBrowser(): boolean {
  const { userAgent, maxTouchPoints } = navigator
  // iPadOS asks for desktop pages as a Mac; only its touch screen tells it apart.
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  return ios && !(navigator as Navigator & { standalone?: boolean }).standalone
}

/**
 * Where vite-plugin-pwa emits the FCM worker. A build-only file: the dev
 * server has none, so registration fails there and push works only in a
 * production build. Its scope is the default one, the script's directory.
 */
export const PUSH_SERVICE_WORKER_URL = '/assets/suite/frontend/sw.js'

/** The relay project the push subscriptions belong to. Existing tokens use it. */
const PUSH_PROJECT = 'mail'

/** The user this browser's push token belongs to. */
export const PUSH_OWNER_KEY = 'suite_push_owner'

type PushClient = InstanceType<typeof import('./frappe-push-notification').default>

/**
 * The notification relay's base URL, or `null` when the site has none. With
 * no relay there is no push: an empty base would send the relay's requests to
 * a path relative to the current page.
 */
function pushRelayURL(): string | null {
  return window.push_relay_server_url || null
}

/**
 * Registers the FCM worker with the relay's web config in its URL, then
 * starts the FCM client on that registration. Does nothing on a site with no
 * relay. Fail-safe: a failure logs and leaves the page as it is. `firebase`
 * loads on demand, outside the shell chunk.
 */
async function registerPushServiceWorker(user: string | null): Promise<PushClient | null> {
  try {
    const relayURL = pushRelayURL()
    if (!relayURL || !('serviceWorker' in navigator)) return null

    const { default: FrappePushNotification } = await import('./frappe-push-notification')
    const client = new FrappePushNotification(PUSH_PROJECT, relayURL)

    let url = PUSH_SERVICE_WORKER_URL
    let config: unknown = ''
    try {
      config = await client.fetchWebConfig()
      url = `${url}?config=${encodeURIComponent(JSON.stringify(config))}`
    } catch (error) {
      console.error('Failed to fetch FCM config', error)
    }

    const registration = await navigator.serviceWorker.register(url, { type: 'module' })
    if (!config) return client
    // A push that arrives while a Suite page is in front comes here, not to the worker.
    client.onMessage((payload) => void registration.showNotification(...pushNotification(payload)))
    await client.initialize(registration)
    await claimPushToken(client, user)
    return client
  } catch (error) {
    console.error('Failed to register service worker', error)
    return null
  }
}

/**
 * Drops a token another user left in this browser, then records the signed-in
 * user as its owner. A token with no recorded owner predates the record; it
 * stays with the user who signs in.
 */
async function claimPushToken(client: PushClient, user: string | null): Promise<void> {
  if (!client.isNotificationEnabled() || !user) return
  const owner = localStorage.getItem(PUSH_OWNER_KEY)
  if (owner && owner !== user) {
    await client.forgetToken()
    localStorage.removeItem(PUSH_OWNER_KEY)
    return
  }
  localStorage.setItem(PUSH_OWNER_KEY, user)
}

const PWA_METAS: Array<[name: string, content: string]> = [
  ['mobile-web-app-capable', 'yes'],
  ['apple-mobile-web-app-capable', 'yes'],
  ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
]

/**
 * Attaches `app`'s manifest, Apple touch icon and iOS splash images to the
 * document head, with the standalone metas, in place of another app's.
 */
export function setPwaTags(app = 'suite'): void {
  if (document.head.querySelector(`[data-pwa-app="${app}"]`)) return
  for (const tag of document.head.querySelectorAll('[data-pwa-app]')) tag.remove()

  const assets = `${import.meta.env.BASE_URL}pwa/${app}/`
  appendPwaTag(app, 'link', { rel: 'manifest', href: `${assets}manifest.webmanifest` })
  appendPwaTag(app, 'link', { rel: 'apple-touch-icon', href: `${assets}apple-icon-180.png` })
  for (const [name, content] of PWA_METAS) appendPwaTag(app, 'meta', { name, content })

  for (const { width: cssWidth, height: cssHeight, dpr } of SPLASH_DEVICES) {
    const device =
      `(device-width: ${cssWidth}px) and (device-height: ${cssHeight}px) and ` +
      `(-webkit-device-pixel-ratio: ${dpr})`
    const [width, height] = [cssWidth * dpr, cssHeight * dpr]
    appendPwaTag(app, 'link', {
      rel: 'apple-touch-startup-image',
      href: `${assets}splash/apple-splash-${width}-${height}.png`,
      media: `${device} and (orientation: portrait)`,
    })
    appendPwaTag(app, 'link', {
      rel: 'apple-touch-startup-image',
      href: `${assets}splash/apple-splash-${height}-${width}.png`,
      media: `${device} and (orientation: landscape)`,
    })
  }
}

function appendPwaTag(app: string, tag: 'link' | 'meta', attrs: Record<string, string>): void {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value)
  element.dataset.pwaApp = app
  document.head.appendChild(element)
}
