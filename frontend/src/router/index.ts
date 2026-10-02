import {
  START_LOCATION,
  createRouter,
  createWebHistory,
  type RouteLocationNormalizedLoaded,
  type RouteRecordNormalized,
  type RouteRecordRaw,
} from 'vue-router'

import { SUITE_APPS } from '@/apps/registry'
import { lastAppPrefix, rememberLastApp } from '@/utils/lastApp'
import {
  areaDefinitions,
  areaIsAvailable,
  findArea,
} from '@/composition/appRegistry'
import {
  areaPlaceholderNames,
  canonicalRoutes,
  driveAreaMounted,
  routes,
} from '@/composition/routes'
import { takeLinkFragment } from '@/composition/linkFragment'
import { redirectOldPath } from '@/composition/redirects'
import { applyRouteMeta, installPageMeta } from '@/platform/page-meta'
import { installPwa } from '@/platform/pwa'
import { installScrollRestoration } from '@/platform/scroll-restoration'
import { useSession } from '@/platform/session'
import { transport, type Operation } from '@/platform/transport'

declare module 'vue-router' {
  interface RouteMeta {
    /** Temporary legacy product identity used by old layouts, the last app and the install offer. */
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
}
// With the files flip on, the Drive area owns `/drive`, so the old Drive pages
// do not mount [T020].
const legacyApps = SUITE_APPS.filter(
  (app) =>
    app.id in legacyRouteLoaders && !(app.id === 'drive' && driveAreaMounted),
).map(
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
// `/` and the PWA start go to Home once the files flip is on. Before it they
// go to the last app, Mail by default [T014].
const startPath = () => (driveAreaMounted ? '/home' : lastAppPrefix())
const notFoundRoute = routes.at(-1)!
const routerRoutes = [
  { path: '/', name: 'suite-root', redirect: startPath },
  ...routes.slice(0, -1),
  {
    path: '/suite/start',
    name: 'suite-start',
    redirect: startPath,
  },
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
  if (areaId === 'mail' || areaId === 'calendar' || areaId === 'meet')
    meta.appId = areaId

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

router.beforeEach(async (to, from) => {
  // A share link's token rides the fragment. It seeds the link store and
  // leaves the URL before any page asks for the node (spec §10.1).
  const withoutLink = takeLinkFragment(to)
  if (withoutLink) return withoutLink

  // Old page URLs go to the flip-2 routes while the files flip is on
  // (spec §14.3). A row the server must answer loads the page from it.
  const moved = redirectOldPath(to, from)
  if (moved !== null) return moved

  // `/l/<token>` is a server page, so a click on one loads it from the server
  // [T014, T015]. A first load that still reaches the SPA falls to Not Found.
  if (isServerLinkPath(to.path) && from !== START_LOCATION) {
    window.location.assign(to.fullPath)
    return false
  }

  const legacyAppId = legacyPlaceholderApp(to)
  if (legacyAppId) {
    await ensureLegacyRoutesLoaded(legacyAppId)
    return to.fullPath
  }

  if (session.status.value === 'loading') await session.refresh()

  // Public Mail entry pages belong to the legacy Mail surface. Load their
  // metadata before the auth gate so their existing allowGuest rules survive.
  // Once loaded, the route carries that metadata, so the gate below decides.
  if (
    session.status.value === 'guest' &&
    isLegacyMailGuestPath(to.path) &&
    !registeredAreas.has('mail')
  ) {
    await ensureAreaRoutesLoaded('mail')
    return to.fullPath
  }

  // A guest may join a Meet call. Load Meet's routes first, so the call
  // route's own metadata decides who may enter.
  if (
    session.status.value === 'guest' &&
    areaPlaceholderId(to) === 'meet'
  ) {
    await ensureAreaRoutesLoaded('meet')
    return to.fullPath
  }

  // A guest may open a shared folder. Load the area's routes first, so the
  // page's own metadata decides who may enter.
  const guestAreaId = areaPlaceholderId(to)
  if (session.status.value === 'guest' && to.meta.allowGuest && guestAreaId) {
    await ensureAreaRoutesLoaded(guestAreaId)
    return to.fullPath
  }

  if (session.status.value === 'guest') {
    if (to.meta.allowGuest) return true
    window.location.href = `/login?redirect-to=${encodeURIComponent(to.fullPath)}`
    return false
  }

  // A shared item opens on a site that is not set up yet. Area routes still
  // go to setup (spec §10.10, ask S3).
  if (!to.meta.allowGuest) {
    const onboarding = await ensureOnboardingState()
    const onSetupPage = to.path === '/suite/setup'
    if (onboarding.canOnboard && !onboarding.isOnboarded) {
      if (!onSetupPage) return '/suite/setup'
    } else if (onSetupPage) {
      return '/suite'
    }
  }

  const areaId = areaPlaceholderId(to)
  if (areaId) {
    const area = findArea(areaId)
    if (
      area &&
      !areaIsAvailable(area, session) &&
      !isMailPathWithoutAccount(to.path)
    )
      return true
    await ensureAreaRoutesLoaded(areaId)
    return to.fullPath
  }

  return true
})

installPageMeta(router)
installScrollRestoration(router)
installPwa(session)

router.afterEach((to, _from, failure) => {
  if (failure) return
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

function isServerLinkPath(path: string): boolean {
  return /^\/(?:drive\/)?l\//.test(path)
}

function isLegacyMailGuestPath(path: string): boolean {
  return /^\/mail\/(?:login|signup(?:\/|$)|reset-password(?:\/|$)|mime-message\/)/.test(
    path,
  )
}

// Mail pages that need no mail account: the public MIME view and the Admin
// Dashboard. They load without the Mail capability; Mail's guard decides.
function isMailPathWithoutAccount(path: string): boolean {
  return /^\/mail\/(?:mime-message\/|dashboard(?:\/|$))/.test(path)
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
