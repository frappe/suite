import {
  createRouter,
  createWebHistory,
  START_LOCATION,
  type RouteLocationNormalizedLoaded,
  type RouteRecordNormalized,
} from 'vue-router'

import { api, client } from '@/api'
import { areaDefinitions, areaIsAvailable, findArea } from '@/composition/appRegistry'
import { takeLinkFragment } from '@/composition/linkFragment'
import { redirectOldPath } from '@/composition/redirects'
import { areaPlaceholderNames, canonicalRoutes, routes } from '@/composition/routes'
import { applyRouteMeta, installPageMeta } from '@/platform/page-meta'
import { installPwa } from '@/platform/pwa'
import { installScrollRestoration } from '@/platform/scroll-restoration'
import { useSession } from '@/platform/session'

// `/`, the PWA start URL and the old launcher URL all open Home.
const startPath = '/home'
const notFoundRoute = routes.at(-1)!
const routerRoutes = [
  { path: '/', name: 'suite-root', redirect: startPath },
  ...routes.slice(0, -1),
  { path: '/suite', name: 'suite-launcher', redirect: startPath },
  { path: '/suite/start', name: 'suite-start', redirect: startPath },
  notFoundRoute,
]

const router = createRouter({
  history: createWebHistory('/'),
  routes: routerRoutes,
})

const session = useSession()
const registeredAreas = new Set<string>()

type OnboardingState = { isOnboarded: boolean; canOnboard: boolean }

const hasServerBoot =
  typeof window !== 'undefined' && typeof window.suite_is_onboarded !== 'undefined'
let onboardingStatePromise: Promise<OnboardingState> | undefined

function ensureOnboardingState(): OnboardingState | Promise<OnboardingState> {
  if (hasServerBoot) {
    return {
      isOnboarded: !!window.suite_is_onboarded,
      canOnboard: !!window.suite_can_onboard,
    }
  }
  if (!onboardingStatePromise) {
    onboardingStatePromise = client
      .query(api.suite.site.get)
      .then((state) => ({ isOnboarded: state.is_onboarded, canOnboard: state.can_onboard }))
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

  router.addRoute({
    path: area.to,
    name: `area-group-${areaId}`,
    component: () => import('@/shell/AppContainer.vue'),
    meta: { ...seed?.meta },
    children: routeModule.routes,
  })
  for (const name of areaPlaceholderNames(areaId)) {
    if (router.hasRoute(name)) router.removeRoute(name)
  }
  registeredAreas.add(areaId)
}

router.beforeEach(async (to, from) => {
  // A share link's token rides the fragment. It seeds the link store and
  // leaves the URL before any page asks for the node (spec §10.1).
  const withoutLink = takeLinkFragment(to)
  if (withoutLink) return withoutLink

  // Old page URLs go to their new routes (spec §14.3). A row the server must
  // answer loads the page from it.
  const moved = redirectOldPath(to, from)
  if (moved !== null) return moved

  // `/l/<token>` is a server page, so a click on one loads it from the server
  // [T014, T015]. A first load that still reaches the SPA falls to Not Found.
  if (isServerLinkPath(to.path) && from !== START_LOCATION) {
    window.location.assign(to.fullPath)
    return false
  }

  if (session.status.value === 'loading') await session.refresh()

  // Public Mail entry pages (login, signup, the MIME view) admit guests. Load
  // their metadata before the auth gate so their own allowGuest rules decide.
  // Once loaded, the route carries that metadata, so the gate below decides.
  if (
    session.status.value === 'guest' &&
    isMailGuestPath(to.path) &&
    !registeredAreas.has('mail')
  ) {
    await ensureAreaRoutesLoaded('mail')
    return to.fullPath
  }

  // A guest may join a Meet call. Load Meet's routes first, so the call
  // route's own metadata decides who may enter.
  if (session.status.value === 'guest' && areaPlaceholderId(to) === 'meet') {
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
      return startPath
    }
  }

  const areaId = areaPlaceholderId(to)
  if (areaId) {
    const area = findArea(areaId)
    if (area && !areaIsAvailable(area, session) && !isMailPathWithoutAccount(to.path)) return true
    await ensureAreaRoutesLoaded(areaId)
    return to.fullPath
  }

  return true
})

installPageMeta(router)
installScrollRestoration(router)
installPwa(session)

function areaPlaceholderId(to: RouteLocationNormalizedLoaded): string | null {
  const matched = to.matched.find((record) =>
    String(record.name ?? '').startsWith('area-placeholder-'),
  )
  return matched && typeof matched.meta.area === 'string' ? matched.meta.area : null
}

function isServerLinkPath(path: string): boolean {
  return /^\/(?:drive\/)?l\//.test(path)
}

function isMailGuestPath(path: string): boolean {
  return /^\/mail\/(?:login|signup(?:\/|$)|reset-password(?:\/|$)|mime-message\/)/.test(path)
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
