import suiteRouter from '@/router'
import { setActiveEntity } from '@/apps/drive/data/selection'

/**
 * Drive router compat shim + app-local navigation guard.
 *
 * The standalone Drive app had its own `createRouter` with a global
 * `beforeEach`/`afterEach`. In the suite there is ONE router (mounted at '/',
 * drive routes live under '/drive'); the suite router's own `beforeEach`
 * already redirects guests to /login for non-`meta.isPublic` routes.
 *
 * Drive's standalone guard also:
 *   - stored `recentTeam` in localStorage,
 *   - cleared the active entity on every navigation,
 *   - stored the current route in sessionStorage.
 * We re-install that behaviour here, scoped to `drive-*` routes only so it
 * never runs for other apps (calendar/writer pattern).
 *
 * Re-exporting the single suite router instance keeps drive utils that read
 * `router.currentRoute` / call `router.push` working unchanged.
 */
const isDriveRoute = (route: { name?: unknown; path?: string }) =>
  (typeof route.name === 'string' && route.name.startsWith('drive-')) ||
  (route.path?.startsWith('/drive') ?? false)

suiteRouter.beforeEach((to, _from, next) => {
  if (!isDriveRoute(to)) return next()
  if (to.params.team) localStorage.setItem('recentTeam', String(to.params.team))
  setActiveEntity(null)
  next()
})

suiteRouter.afterEach((to) => {
  if (!isDriveRoute(to)) return
  sessionStorage.setItem('currentRoute', to.href)
})

export const router = suiteRouter
export default suiteRouter
