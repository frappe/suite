import {
  getCurrentInstance,
  getCurrentScope,
  onActivated,
  onDeactivated,
  onScopeDispose,
  onUnmounted,
  watch,
} from 'vue'
import type { HistoryState, RouteLocationNormalizedLoaded, Router } from 'vue-router'

type TitleRegistration = {
  id: symbol
  active: boolean
  title: string
  order: number
}

const registrations: TitleRegistration[] = []
let routeTitle = ''
let order = 0
let installedRouter: Router | null = null

const OPENING_TITLE = 'pageTitle'

/**
 * History state that names the page a navigation opens. The tab shows this
 * title in place of the route's own until the page registers a title, so a
 * link that knows its target's name never shows a placeholder. Back and
 * forward keep it, because it is part of the history entry.
 */
export function openingTitleState(title: string): HistoryState {
  return title ? { [OPENING_TITLE]: title } : {}
}

/** The title an entry's opener gave it through `openingTitleState`, or `null`. */
export function openingTitle(state: HistoryState): string | null {
  const title = state[OPENING_TITLE]
  return typeof title === 'string' && title ? title : null
}

export function installPageMeta(router: Router): () => void {
  installedRouter = router
  applyRouteMeta(router.currentRoute.value, router.options.history.state)
  // The history entry, and so its state, is already current in `afterEach`.
  const remove = router.afterEach((to, _from, failure) => {
    if (!failure) applyRouteMeta(to, router.options.history.state)
  })
  return () => {
    remove()
    if (installedRouter === router) installedRouter = null
  }
}

export function usePageTitle(source: () => string): () => void {
  const registration: TitleRegistration = {
    id: Symbol('page-title'),
    active: true,
    title: source(),
    order: ++order,
  }
  registrations.push(registration)
  const stopWatch = watch(source, (title) => {
    registration.title = title
    registration.order = ++order
    renderTitle()
  })

  const activate = () => {
    registration.active = true
    registration.order = ++order
    renderTitle()
  }
  const deactivate = () => {
    registration.active = false
    renderTitle()
  }
  const release = once(() => {
    stopWatch()
    const index = registrations.findIndex(({ id }) => id === registration.id)
    if (index !== -1) registrations.splice(index, 1)
    renderTitle()
  })

  if (getCurrentInstance()) {
    onActivated(activate)
    onDeactivated(deactivate)
    onUnmounted(release)
  }
  if (getCurrentScope()) {
    onScopeDispose(release)
  }
  renderTitle()
  return release
}

export function applyRouteMeta(
  route: RouteLocationNormalizedLoaded,
  state: HistoryState = {},
): void {
  routeTitle = openingTitle(state) ?? (typeof route.meta.title === 'string' ? route.meta.title : '')
  setFavicon(typeof route.meta.favicon === 'string' ? route.meta.favicon : null)
  renderTitle()
}

function renderTitle(): void {
  if (typeof document === 'undefined') return
  const override = registrations
    .filter(({ active, title }) => active && !!title)
    .sort((a, b) => b.order - a.order)[0]
  document.title = override?.title || routeTitle
}

function setFavicon(href: string | null): void {
  if (typeof document === 'undefined' || !href) return
  let icon = document.querySelector<HTMLLinkElement>("link[rel='icon']")
  if (!icon) {
    icon = document.createElement('link')
    icon.rel = 'icon'
    document.head.appendChild(icon)
  }
  icon.href = href
  icon.type = faviconType(href)
}

function faviconType(href: string): string {
  if (/\.svg(?:$|\?)/.test(href)) return 'image/svg+xml'
  if (/\.png(?:$|\?)/.test(href)) return 'image/png'
  return 'image/x-icon'
}

function once(cleanup: () => void): () => void {
  let done = false
  return () => {
    if (done) return
    done = true
    cleanup()
  }
}
