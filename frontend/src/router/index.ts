import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalizedLoaded,
  type RouteRecordRaw,
} from 'vue-router'
import { createResource } from 'frappe-ui'

import { SUITE_APPS, SUITE_LOGO } from '@/apps/registry'
import { hasServerBoot, useSessionStore } from '@/boot/session'
import APPLE_SPLASH_DEVICES from './pwa-splash-devices.json'

declare module 'vue-router' {
  interface RouteMeta {
    appId?: string
    title?: string
    favicon?: string
    isShell?: boolean
    allowGuest?: boolean
  }
}

/**
 * ONE Vue Router for the whole suite.
 *
 * Each of the 7 apps contributes a route GROUP mounted at its original prefix
 * (/drive /slides /writer /sheets /meet /mail /calendar). Every group lazy-loads
 * `src/apps/<id>/routes.ts`, which exports a `routes: RouteRecordRaw[]` array
 * RELATIVE to that prefix (paths without a leading slash; the empty-path child
 * is the app's index). This keeps per-app bundles code-split so the shell stays
 * small (heavy app deps — mediasoup, firebase, xlsx, docx — load only on demand).
 *
 * `/suite` is the launcher (app switcher).
 *
 * Lazy registration: each app's prefix initially resolves to a placeholder
 * record carrying `meta.appId`. The first navigation into a prefix loads that
 * app's route module, replaces the placeholder with a real group containing the
 * module's `routes`, and re-resolves the navigation (see `beforeEach`).
 */

// Dynamic-import loaders for each app's route module. The import is a dynamic
// `import()` so the app's actual views/components stay code-split.
const appRouteLoaders: Record<string, () => Promise<{ routes: RouteRecordRaw[] }>> = {
  drive: () => import('@/apps/drive/routes'),
  slides: () => import('@/apps/slides/routes'),
  writer: () => import('@/apps/writer/routes'),
  sheets: () => import('@/apps/sheets/routes'),
  meet: () => import('@/apps/meet/routes'),
  mail: () => import('@/apps/mail/routes'),
  calendar: () => import('@/apps/calendar/routes'),
}

const SUITE_FAVICON = SUITE_LOGO
let currentFaviconScope: string | undefined

// Placeholder record per app: matches the prefix + everything under it and
// carries `meta.appId`. `beforeEach` swaps it for the real routes on first hit.
const placeholderGroups: RouteRecordRaw[] = SUITE_APPS.map((app) => ({
  path: `${app.prefix}/:pathMatch(.*)*`,
  name: `${app.id}-placeholder`,
  component: () => import('@/shell/AppContainer.vue'),
  meta: { appId: app.id, title: `Frappe ${app.name}`, favicon: app.logo },
}))

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/suite',
  },
  {
    path: '/suite',
    name: 'suite-launcher',
    component: () => import('@/shell/LauncherView.vue'),
    meta: { isShell: true, title: 'Frappe Suite', favicon: SUITE_FAVICON },
  },
  {
    path: '/suite/setup',
    name: 'suite-setup',
    component: () => import('@/shell/SetupView.vue'),
    meta: { isShell: true, title: 'Set up Frappe Suite', favicon: SUITE_FAVICON },
  },
  ...placeholderGroups,
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/shell/NotFoundView.vue'),
    meta: { title: 'Frappe Suite', favicon: SUITE_FAVICON },
  },
]

const router = createRouter({
  // Served at site root; the SPA owns all the app prefixes below '/'.
  history: createWebHistory('/'),
  routes,
})

// Apps whose real route groups have already been registered.
const registeredApps = new Set<string>()

// First-run onboarding state: boot globals in prod, fetch in dev.
type OnboardingState = { isOnboarded: boolean; canOnboard: boolean }

const onboardingStateResource = createResource({ url: 'suite.api.account.get_onboarding_state' })
let onboardingStatePromise: Promise<OnboardingState> | undefined

function ensureOnboardingState(): OnboardingState | Promise<OnboardingState> {
  if (hasServerBoot) {
    return { isOnboarded: !!window.suite_is_onboarded, canOnboard: !!window.suite_can_onboard }
  }
  if (!onboardingStatePromise) {
    onboardingStatePromise = onboardingStateResource
      .fetch()
      .then(() => ({
        isOnboarded: !!onboardingStateResource.data?.is_onboarded,
        canOnboard: !!onboardingStateResource.data?.can_onboard,
      }))
      .catch(() => {
        // Fail open: a failing check must not strand anyone on the setup screen.
        onboardingStatePromise = undefined
        return { isOnboarded: true, canOnboard: false }
      })
  }
  return onboardingStatePromise
}

/**
 * Load `src/apps/<appId>/routes.ts`, register its routes under the app prefix
 * inside an AppContainer group, and drop the placeholder so future navigations
 * resolve straight to the real routes.
 */
async function ensureAppRoutesLoaded(appId: string): Promise<void> {
  if (registeredApps.has(appId)) return

  const loader = appRouteLoaders[appId]
  const app = SUITE_APPS.find((a) => a.id === appId)
  if (!loader || !app) return

  const mod = await loader()

  router.addRoute({
    path: app.prefix,
    component: () => import('@/shell/AppContainer.vue'),
    meta: { appId, title: `Frappe ${app.name}`, favicon: app.logo },
    children: mod.routes,
  })

  // Remove the catch-all placeholder so it no longer shadows the real routes.
  if (router.hasRoute(`${appId}-placeholder`)) {
    router.removeRoute(`${appId}-placeholder`)
  }

  registeredApps.add(appId)
}

router.beforeEach(async (to) => {
  // 1. Lazy-load the target app's route module before resolving the route.
  const appId = to.meta.appId
  if (appId && !registeredApps.has(appId)) {
    await ensureAppRoutesLoaded(appId)
    // Re-resolve now that the real routes exist without replacing the previous
    // page in browser history.
    return to.fullPath
  }

  // 2. Auth gate (shell launcher + every app require a logged-in user).
  const session = useSessionStore()
  if (!session.isLoggedIn && !to.meta.allowGuest) {
    window.location.href = `/login?redirect-to=${encodeURIComponent(to.fullPath)}`
    return false
  }

  // 3. First-run onboarding gate. Only System Managers are sent to /suite/setup —
  // they alone can complete it; everyone else uses the site as-is.
  const onboarding = await ensureOnboardingState()
  const onSetupPage = to.path === '/suite/setup'
  if (onboarding.canOnboard && !onboarding.isOnboarded) {
    if (!onSetupPage) return '/suite/setup'
  } else if (onSetupPage) {
    return '/suite'
  }

  return true
})

router.afterEach((to, from, failure) => {
  // A failed navigation (e.g. re-clicking the current folder, which vue-router reports
  // as duplicated but still runs afterEach for) leaves the page untouched — resetting
  // the title here would clobber the one the view set via usePageMeta.
  if (failure) return
  setDocumentTitle(to, from)
  setFavicon(to)
  setPwaTags(to)
})

export function setDocumentTitle(
  to: RouteLocationNormalizedLoaded,
  from: RouteLocationNormalizedLoaded,
) {
  // a same-view replace leaves the view mounted, so its usePageMeta title stands
  const view = to.matched.at(-1)
  if (view && view === from.matched.at(-1)) return

  if (to.meta.title) {
    document.title = to.meta.title
  }
}

function setFavicon(to: RouteLocationNormalizedLoaded) {
  const favicon = to.meta.favicon
  if (!favicon) return

  const scope = to.meta.appId ?? 'suite'
  if (scope === currentFaviconScope) return

  const icon = getFaviconElement()
  icon.href = favicon
  icon.type = getFaviconType(favicon)
  currentFaviconScope = scope
}

function getFaviconElement() {
  let icon = document.querySelector<HTMLLinkElement>("link[rel='icon']")
  if (!icon) {
    icon = document.createElement('link')
    icon.rel = 'icon'
    document.head.appendChild(icon)
  }
  return icon
}

/**
 * Mail is the only installable app in the suite. Since every app is served from
 * the same HTML shell, the manifest and the iOS standalone metas cannot live in
 * index.html — Add to Home Screen from /drive would then install Frappe Mail.
 * They are attached on entering /mail and removed on leaving; both Chrome
 * (beforeinstallprompt) and iOS (which reads <head> at the moment the user taps
 * Add to Home Screen) evaluate them live, so this is enough to scope install to
 * mail. Outside mail the browser falls back to a plain bookmark/shortcut.
 */
const MAIL_PWA_METAS: Array<[name: string, content: string]> = [
  ['mobile-web-app-capable', 'yes'],
  ['apple-mobile-web-app-capable', 'yes'],
  // Transparent status bar in iOS standalone: iOS only samples theme-color at
  // launch, so a theme toggle left the bar stale until relaunch. Translucent
  // lets the app's own background show through instead — safe-area-inset-top
  // paddings on the full-screen surfaces keep content out from under it.
  ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
]


let pwaTagsAttached = false

function setPwaTags(to: RouteLocationNormalizedLoaded) {
  const installable = to.meta.appId === 'mail'
  if (installable === pwaTagsAttached) return
  pwaTagsAttached = installable

  if (!installable) {
    document.head.querySelectorAll('[data-pwa-scope="mail"]').forEach((el) => el.remove())
    return
  }

  // BASE_URL keeps these resolvable in dev ('/') and prod
  // ('/assets/suite/frontend/') alike; the manifest's own icon srcs are
  // relative to it for the same reason.
  const assets = `${import.meta.env.BASE_URL}pwa/mail/`
  appendPwaTag('link', { rel: 'manifest', href: `${assets}manifest.webmanifest` })
  // Without this iOS shows a gray monogram on the home screen.
  appendPwaTag('link', { rel: 'apple-touch-icon', href: `${assets}apple-icon-180.png` })
  for (const [name, content] of MAIL_PWA_METAS) appendPwaTag('meta', { name, content })

  // iOS ignores the manifest when drawing the launch screen — unlike Chrome it
  // composites nothing from name/icon/background_color. It blits an
  // apple-touch-startup-image whose media query matches the device exactly, and
  // a blank screen when none does, so coverage is strictly per device size.
  // pwa-splash-devices.json holds the sizes in CSS px + DPR; the artwork is
  // named in physical px (css x DPR) and is generated from that same file by
  // scripts/generate-pwa-splash.mjs, so filenames here cannot drift from disk.
  for (const { width: cssWidth, height: cssHeight, dpr } of APPLE_SPLASH_DEVICES) {
    // device-width/height stay in the device's portrait orientation on iOS —
    // they do not swap when it rotates, so both entries share one query and
    // only the artwork and the orientation term differ.
    const device =
      `(device-width: ${cssWidth}px) and (device-height: ${cssHeight}px) and ` +
      `(-webkit-device-pixel-ratio: ${dpr})`
    const [w, h] = [cssWidth * dpr, cssHeight * dpr]
    appendPwaTag('link', {
      rel: 'apple-touch-startup-image',
      href: `${assets}splash/apple-splash-${w}-${h}.png`,
      media: `${device} and (orientation: portrait)`,
    })
    appendPwaTag('link', {
      rel: 'apple-touch-startup-image',
      href: `${assets}splash/apple-splash-${h}-${w}.png`,
      media: `${device} and (orientation: landscape)`,
    })
  }
}

function appendPwaTag(tag: 'link' | 'meta', attrs: Record<string, string>) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
  el.dataset.pwaScope = 'mail'
  document.head.appendChild(el)
}

function getFaviconType(favicon: string) {
  if (favicon.includes('.svg')) return 'image/svg+xml'
  if (favicon.includes('.png')) return 'image/png'
  return 'image/x-icon'
}

export default router
