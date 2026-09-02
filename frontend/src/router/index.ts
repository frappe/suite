import {
  createRouter,
  createWebHistory,
  type NavigationGuardReturn,
  type RouteLocationNormalized,
  type RouteLocationNormalizedLoaded,
  type RouteRecordRaw,
} from 'vue-router'
import { createResource } from 'frappe-ui'

import { SUITE_APPS, SUITE_LOGO } from '@/apps/registry'
import { routes as calendarRoutes } from '@/apps/calendar/routes'
import { routes as driveRoutes } from '@/apps/drive/routes'
import { routes as mailRoutes } from '@/apps/mail/routes'
import { routes as meetRoutes } from '@/apps/meet/routes'
import { routes as sheetsRoutes } from '@/apps/sheets/routes'
import { routes as slidesRoutes } from '@/apps/slides/routes'
import { routes as writerRoutes } from '@/apps/writer/routes'
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
 * Each app contributes lightweight route definitions mounted at its original
 * prefix. Views and app-specific runtime behavior remain lazy, while the full
 * route table and metadata are available on the first navigation.
 *
 * `/suite` is the launcher (app switcher).
 *
 */

const appRoutes: Record<string, RouteRecordRaw[]> = {
  drive: driveRoutes,
  slides: slidesRoutes,
  writer: writerRoutes,
  sheets: sheetsRoutes,
  meet: meetRoutes,
  mail: mailRoutes,
  calendar: calendarRoutes,
}

/**
 * Lazy app lifecycle: bootstrap runs once before the first navigation,
 * beforeEach gates every app navigation, and afterEach runs after completion.
 */
type AppRuntime = {
  bootstrap?: () => void | Promise<void>
  beforeEach?: (
    to: RouteLocationNormalized,
    from: RouteLocationNormalizedLoaded,
  ) => NavigationGuardReturn | Promise<NavigationGuardReturn>
  afterEach?: (to: RouteLocationNormalizedLoaded) => void
}

const appRuntimeLoaders: Record<string, () => Promise<AppRuntime>> = {
  drive: () => import('@/apps/drive/runtime'),
  slides: () => import('@/apps/slides/runtime'),
  writer: () => import('@/apps/writer/runtime'),
  meet: () => import('@/apps/meet/runtime'),
  mail: () => import('@/apps/mail/runtime'),
  calendar: () => import('@/apps/calendar/runtime'),
}

const appRuntimePromises = new Map<string, Promise<AppRuntime>>()
const loadedAppRuntimes = new Map<string, AppRuntime>()

function ensureAppRuntime(appId: string): Promise<AppRuntime> | undefined {
  const loader = appRuntimeLoaders[appId]
  if (!loader) return

  let promise = appRuntimePromises.get(appId)
  if (!promise) {
    promise = loader()
      .then(async (runtime) => {
        await runtime.bootstrap?.()
        loadedAppRuntimes.set(appId, runtime)
        return runtime
      })
      .catch((error) => {
        appRuntimePromises.delete(appId)
        throw error
      })
    appRuntimePromises.set(appId, promise)
  }
  return promise
}

const SUITE_FAVICON = SUITE_LOGO
let currentFaviconScope: string | undefined

const appGroups: RouteRecordRaw[] = SUITE_APPS.map((app) => ({
  path: app.prefix,
  component: () => import('@/shell/AppContainer.vue'),
  meta: { appId: app.id, title: `Frappe ${app.name}`, favicon: app.logo },
  children: appRoutes[app.id],
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
  {
    path: '/suite/load-error',
    name: 'app-load-error',
    component: () => import('@/shell/AppLoadErrorView.vue'),
    meta: {
      isShell: true,
      allowGuest: true,
      title: 'Frappe Suite',
      favicon: SUITE_FAVICON,
    },
  },
  ...appGroups,
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

router.beforeEach(async (to, from) => {
  // 1. Auth gate (shell launcher + every app require a logged-in user).
  const session = useSessionStore()
  if (!session.isLoggedIn && !to.meta.allowGuest) {
    window.location.href = `/login?redirect-to=${encodeURIComponent(to.fullPath)}`
    return false
  }

  // 2. First-run onboarding gate. Only System Managers are sent to /suite/setup —
  // they alone can complete it; everyone else uses the site as-is.
  const onboarding = await ensureOnboardingState()
  const onSetupPage = to.path === '/suite/setup'
  if (onboarding.canOnboard && !onboarding.isOnboarded) {
    if (!onSetupPage) return '/suite/setup'
  } else if (onSetupPage) {
    return '/suite'
  }

  // 3. Load only the target app's initialization and local guard behavior.
  const appId = to.meta.appId
  if (!appId) return true

  let runtime: AppRuntime | undefined
  try {
    runtime = await ensureAppRuntime(appId)
  } catch (error) {
    console.error(`Failed to load ${appId} runtime`, error)
    return {
      name: 'app-load-error',
      query: { app: appId, redirect: to.fullPath },
    }
  }
  return (await runtime?.beforeEach?.(to, from)) ?? true
})

router.afterEach((to, from, failure) => {
  // A failed navigation (e.g. re-clicking the current folder, which vue-router reports
  // as duplicated but still runs afterEach for) leaves the page untouched — resetting
  // the title here would clobber the one the view set via usePageMeta.
  if (failure) return
  setDocumentTitle(to, from)
  setFavicon(to)
  setPwaTags(to)
  const appId = to.meta.appId
  if (appId) loadedAppRuntimes.get(appId)?.afterEach?.(to)
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
