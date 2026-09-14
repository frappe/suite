import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalizedLoaded,
  type RouteRecordNormalized,
  type RouteRecordRaw,
} from 'vue-router'

import { SUITE_APPS, isInstallableApp } from '@/apps/registry'
import { rememberLastApp } from '@/utils/lastApp'
import {
  areaDefinitions,
  areaIsAvailable,
  findArea,
} from '@/composition/appRegistry'
import {
  areaPlaceholderNames,
  canonicalRoutes,
  routes,
} from '@/composition/routes'
import { applyRouteMeta, installPageMeta } from '@/platform/page-meta'
import { useSession } from '@/platform/session'
import { transport, type Operation } from '@/platform/transport'
import APPLE_SPLASH_DEVICES from './pwa-splash-devices.json'

declare module 'vue-router' {
  interface RouteMeta {
    /** Temporary legacy product identity used by old layouts and Mail PWA scoping. */
    appId?: string
  }
}

const legacyRouteLoaders: Record<
  string,
  () => Promise<{ routes: RouteRecordRaw[] }>
> = {
  drive: () => import('@/apps/drive/legacy/routes'),
  slides: () => import('@/apps/slides/routes'),
  writer: () => import('@/apps/writer/routes'),
  sheets: () => import('@/apps/sheets/routes'),
  meet: () => import('@/apps/meet/routes'),
}
const legacyApps = SUITE_APPS.filter((app) => app.id in legacyRouteLoaders).map(
  (app) => ({
    ...app,
    loadRoutes: legacyRouteLoaders[app.id]!,
  }),
)
const legacyPlaceholderGroups: RouteRecordRaw[] = legacyApps.map((app) => ({
  path: `${app.prefix}/:pathMatch(.*)*`,
  name: `legacy-placeholder-${app.id}`,
  component: () => import('@/shell/AppContainer.vue'),
  meta: {
    appId: app.id,
    frame: 'none',
    scroll: 'content',
    title: `Frappe ${app.name}`,
    favicon: app.logo,
  },
}))
const notFoundRoute = routes.at(-1)!
const routerRoutes = [
  ...routes.slice(0, -1),
  ...legacyPlaceholderGroups,
  notFoundRoute,
]

const router = createRouter({
  history: createWebHistory('/'),
  routes: routerRoutes,
})

const session = useSession()
const registeredAreas = new Set<string>()
const registeredLegacyApps = new Set<string>()

type OnboardingState = { isOnboarded: boolean; canOnboard: boolean }

const hasServerBoot =
  typeof window !== 'undefined' &&
  typeof window.suite_is_onboarded !== 'undefined'
const onboardingOperation: Operation<
  Record<string, never>,
  { is_onboarded?: boolean; can_onboard?: boolean }
> = {
  id: 'suite.onboarding-state',
  owner: 'suite',
  method: 'GET',
  path: '/api/v2/method/suite.api.account.get_onboarding_state',
}
let onboardingStatePromise: Promise<OnboardingState> | undefined

function ensureOnboardingState(): OnboardingState | Promise<OnboardingState> {
  if (hasServerBoot) {
    return {
      isOnboarded: !!window.suite_is_onboarded,
      canOnboard: !!window.suite_can_onboard,
    }
  }
  if (!onboardingStatePromise) {
    onboardingStatePromise = transport
      .request(onboardingOperation, {})
      .then((response) => {
        const state =
          'message' in response &&
          response.message &&
          typeof response.message === 'object'
            ? (response.message as {
                is_onboarded?: boolean
                can_onboard?: boolean
              })
            : response
        return {
          isOnboarded: !!state.is_onboarded,
          canOnboard: !!state.can_onboard,
        }
      })
      .catch(() => {
        onboardingStatePromise = undefined
        return { isOnboarded: true, canOnboard: false }
      })
  }
  return onboardingStatePromise
}

async function ensureAreaRoutesLoaded(areaId: string): Promise<void> {
  if (registeredAreas.has(areaId)) return
  const area = findArea(areaId)
  if (!area) return
  const routeModule = await area.loadRoutes()
  const seed = canonicalRoutes.find((route) => route.meta?.area === areaId)
  const meta = { ...seed?.meta }
  if (areaId === 'mail' || areaId === 'calendar') meta.appId = areaId

  router.addRoute({
    path: area.to,
    name: `area-group-${areaId}`,
    component: () => import('@/shell/AppContainer.vue'),
    meta,
    children: routeModule.routes,
  })
  for (const name of areaPlaceholderNames(areaId)) {
    if (router.hasRoute(name)) router.removeRoute(name)
  }
  registeredAreas.add(areaId)
}

async function ensureLegacyRoutesLoaded(appId: string): Promise<void> {
  if (registeredLegacyApps.has(appId)) return
  const app = legacyApps.find((candidate) => candidate.id === appId)
  if (!app) return
  const routeModule = await app.loadRoutes()
  router.addRoute({
    path: app.prefix,
    name: `legacy-group-${appId}`,
    component: () => import('@/shell/AppContainer.vue'),
    meta: {
      appId,
      frame: 'none',
      scroll: 'content',
      title: `Frappe ${app.name}`,
      favicon: app.logo,
    },
    children: routeModule.routes,
  })
  const placeholderName = `legacy-placeholder-${appId}`
  if (router.hasRoute(placeholderName)) router.removeRoute(placeholderName)
  registeredLegacyApps.add(appId)
}

router.beforeEach(async (to) => {
  const legacyAppId = legacyPlaceholderApp(to)
  if (legacyAppId) {
    await ensureLegacyRoutesLoaded(legacyAppId)
    return to.fullPath
  }

  if (session.status.value === 'loading') await session.refresh()

  // Public Mail entry pages belong to the legacy Mail surface. Load their
  // metadata before the auth gate so their existing allowGuest rules survive.
  if (session.status.value === 'guest' && isLegacyMailGuestPath(to.path)) {
    await ensureAreaRoutesLoaded('mail')
    return to.fullPath
  }

  if (session.status.value === 'guest') {
    if (to.meta.allowGuest) return true
    window.location.href = `/login?redirect-to=${encodeURIComponent(to.fullPath)}`
    return false
  }

  const onboarding = await ensureOnboardingState()
  const onSetupPage = to.path === '/suite/setup'
  if (onboarding.canOnboard && !onboarding.isOnboarded) {
    if (!onSetupPage) return '/suite/setup'
  } else if (onSetupPage) {
    return '/suite'
  }

  const areaId = areaPlaceholderId(to)
  if (areaId) {
    const area = findArea(areaId)
    if (area && !areaIsAvailable(area, session)) return true
    await ensureAreaRoutesLoaded(areaId)
    return to.fullPath
  }

  return true
})

installPageMeta(router)

router.afterEach((to, _from, failure) => {
  if (failure) return
  setPwaTags(to)
  rememberLastApp(to.meta.appId ?? to.meta.area)
})

function areaPlaceholderId(to: RouteLocationNormalizedLoaded): string | null {
  const matched = to.matched.find((record) =>
    String(record.name ?? '').startsWith('area-placeholder-'),
  )
  return matched && typeof matched.meta.area === 'string'
    ? matched.meta.area
    : null
}

function legacyPlaceholderApp(
  to: RouteLocationNormalizedLoaded,
): string | null {
  const matched = to.matched.find((record) =>
    String(record.name ?? '').startsWith('legacy-placeholder-'),
  )
  return matched && typeof matched.meta.appId === 'string'
    ? matched.meta.appId
    : null
}

function isLegacyMailGuestPath(path: string): boolean {
  return /^\/mail\/(?:login|signup(?:\/|$)|reset-password(?:\/|$)|mime-message\/)/.test(
    path,
  )
}

/**
 * The suite installs as one app. The install offer appears only in product
 * areas whose registry entry has a phone layout.
 */
const PWA_METAS: Array<[name: string, content: string]> = [
  ['mobile-web-app-capable', 'yes'],
  ['apple-mobile-web-app-capable', 'yes'],
  ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
]

let pwaTagsAttached = false

function setPwaTags(to: RouteLocationNormalizedLoaded) {
  const installable = isInstallableApp(to.meta.appId ?? to.meta.area)
  if (installable === pwaTagsAttached) return
  pwaTagsAttached = installable

  if (!installable) {
    document.head
      .querySelectorAll('[data-pwa-scope="suite"]')
      .forEach((element) => element.remove())
    return
  }

  const assets = `${import.meta.env.BASE_URL}pwa/suite/`
  appendPwaTag('link', {
    rel: 'manifest',
    href: `${assets}manifest.webmanifest`,
  })
  appendPwaTag('link', {
    rel: 'apple-touch-icon',
    href: `${assets}apple-icon-180.png`,
  })
  for (const [name, content] of PWA_METAS)
    appendPwaTag('meta', { name, content })

  for (const {
    width: cssWidth,
    height: cssHeight,
    dpr,
  } of APPLE_SPLASH_DEVICES) {
    const device =
      `(device-width: ${cssWidth}px) and (device-height: ${cssHeight}px) and ` +
      `(-webkit-device-pixel-ratio: ${dpr})`
    const [width, height] = [cssWidth * dpr, cssHeight * dpr]
    appendPwaTag('link', {
      rel: 'apple-touch-startup-image',
      href: `${assets}splash/apple-splash-${width}-${height}.png`,
      media: `${device} and (orientation: portrait)`,
    })
    appendPwaTag('link', {
      rel: 'apple-touch-startup-image',
      href: `${assets}splash/apple-splash-${height}-${width}.png`,
      media: `${device} and (orientation: landscape)`,
    })
  }
}

function appendPwaTag(tag: 'link' | 'meta', attrs: Record<string, string>) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs))
    element.setAttribute(key, value)
  element.dataset.pwaScope = 'suite'
  document.head.appendChild(element)
}

/** @deprecated Page metadata is installed through @/platform/page-meta. */
export function setDocumentTitle(
  to: RouteLocationNormalizedLoaded,
  from: RouteLocationNormalizedLoaded,
) {
  const view = to.matched.at(-1)
  if (!to.meta.title || (view && viewOf(view) === viewOf(from.matched.at(-1)))) return
  applyRouteMeta(to)
}

function viewOf(record?: RouteRecordNormalized) {
  return record?.components?.default ?? record
}

export { areaDefinitions }
export default router
