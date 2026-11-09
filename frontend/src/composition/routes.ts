import { defineAsyncComponent, defineComponent, h, type Component } from 'vue'
import type { RouteMeta, RouteRecordRaw } from 'vue-router'

import { RECOVERY_COPIES_TITLE } from '@/apps/drive'
import type { PhoneChromeOwner, ShellFrame } from '@/platform/contracts'
import AppLoadErrorView from '@/shell/AppLoadErrorView.vue'

const RouteLoading = defineComponent({
  name: 'RouteLoading',
  setup: () => () => h('div', { class: 'h-full min-h-0 w-full min-w-0' }),
})

function areaMeta(
  area: string,
  title: string,
  options: {
    frame?: ShellFrame
    scroll?: 'shell' | 'content'
    phoneChrome?: PhoneChromeOwner
    allowGuest?: boolean
  } = {},
): RouteMeta {
  return {
    area,
    frame: options.frame ?? 'shell',
    scroll: options.scroll ?? 'shell',
    phoneChrome: options.phoneChrome,
    allowGuest: options.allowGuest,
    title,
  }
}

function placeholder(
  path: string,
  name: string,
  meta: RouteMeta,
  component: Component = RouteLoading,
): RouteRecordRaw {
  return { path, name, component, meta }
}

/**
 * One placeholder per area entry URL. The router swaps a placeholder for the
 * area's route group the first time a URL under it is visited.
 */
export const canonicalRoutes: RouteRecordRaw[] = [
  placeholder(
    '/admin/:pathMatch(.*)*',
    'area-placeholder-admin',
    areaMeta('admin', 'Admin', { scroll: 'content' }),
  ),
  placeholder('/home', 'area-placeholder-home', areaMeta('home', 'Home')),
  placeholder('/drive', 'area-placeholder-files-root', areaMeta('files', 'My files')),
  placeholder(
    '/drive/organization',
    'area-placeholder-files-organization',
    areaMeta('files', 'Organization files'),
  ),
  placeholder(
    '/drive/f/:node/:slug?',
    'area-placeholder-files-folder',
    areaMeta('files', 'Folder', { allowGuest: true }),
  ),
  placeholder('/drive/recent', 'area-placeholder-files-recent', areaMeta('files', 'Recent')),
  placeholder('/drive/starred', 'area-placeholder-files-starred', areaMeta('files', 'Starred')),
  placeholder(
    '/drive/shared-with-me',
    'area-placeholder-files-shared-with-me',
    areaMeta('files', 'Shared with me'),
  ),
  placeholder('/drive/trash', 'area-placeholder-files-trash', areaMeta('files', 'Trash')),
  placeholder(
    '/drive/recovery',
    'area-placeholder-files-recovery',
    areaMeta('files', RECOVERY_COPIES_TITLE),
  ),
  // Mail owns its phone chrome by default: an open thread and the composer are
  // full screen. Its list pages ask the shell for its chrome through
  // `useShellPhoneChrome`. The area group copies this metadata, so every Mail
  // page inherits it.
  placeholder(
    '/mail/:pathMatch(.*)*',
    'area-placeholder-mail',
    areaMeta('mail', 'Mail', {
      scroll: 'content',
      phoneChrome: 'page',
    }),
  ),
  placeholder(
    '/calendar/:pathMatch(.*)*',
    'area-placeholder-calendar',
    areaMeta('calendar', 'Calendar', { scroll: 'content' }),
  ),
  placeholder(
    '/people/:pathMatch(.*)*',
    'area-placeholder-people',
    areaMeta('people', 'People', { scroll: 'content' }),
  ),
  // One placeholder holds the whole prefix. A call (`/meet/:meetingId`) sets
  // its own frame `none` and admits guests in Meet's route module.
  placeholder(
    '/meet/:pathMatch(.*)*',
    'area-placeholder-meet',
    areaMeta('meet', 'Meet', { scroll: 'content' }),
  ),
  // The tab says "Opening…" until the document host names it after the node,
  // unless the opener named the node in the history entry (`openingTitleState`).
  // The host stays mounted from the document to its slideshow, so the open
  // session and its loaded slides carry over. Neither child renders anything
  {
    path: '/d/:node',
    component: defineAsyncRoute(() => import('@/composition/DocumentHost.vue')),
    meta: areaMeta('files', 'Opening…', {
      scroll: 'content',
      allowGuest: true,
    }),
    children: [
      { path: 'present', name: 'slides-slideshow', component: RouteLoading },
      { path: ':slug?', name: 'document-host', component: RouteLoading },
    ],
  },
]

export const routes: RouteRecordRaw[] = [
  ...canonicalRoutes,
  // Joining a workspace (spec 001 §4.1): an invitation link, the sign-in for a
  // temporary password, and, once signed in, the forced password change and
  // the welcome steps. One view walks them all.
  {
    path: '/join/:requestKey?',
    name: 'suite-join',
    component: () => import('@/composition/onboarding/JoinView.vue'),
    props: true,
    meta: {
      frame: 'none',
      scroll: 'content',
      allowGuest: true,
      title: 'Join Frappe Suite',
      onboarding: true,
    },
  },
  {
    path: '/suite/change-password',
    name: 'suite-change-password',
    component: () => import('@/composition/onboarding/JoinView.vue'),
    meta: { frame: 'none', scroll: 'content', title: 'Choose your own password', onboarding: true },
  },
  {
    path: '/suite/welcome',
    name: 'suite-welcome',
    component: () => import('@/composition/onboarding/JoinView.vue'),
    meta: { frame: 'none', scroll: 'content', title: 'Welcome to Frappe Suite', onboarding: true },
  },
  {
    path: '/draw',
    redirect: '/home',
    meta: areaMeta('home', 'Home'),
  },
  {
    path: '/draw/editor',
    redirect: (to) =>
      typeof to.query.drawing === 'string' && to.query.drawing
        ? { name: 'document-host', params: { node: to.query.drawing } }
        : '/home',
    meta: areaMeta('files', 'Opening…', { scroll: 'content' }),
  },
  {
    path: '/suite/setup',
    name: 'suite-setup',
    component: () => import('@/composition/onboarding/SetupView.vue'),
    meta: {
      frame: 'none',
      scroll: 'content',
      title: 'Set up Frappe Suite',
      onboarding: true,
    },
  },
  // Where a page whose code failed to load lands (`@/platform/load-failure`).
  // Imported eagerly: after a deploy, a lazy chunk of this view is gone too.
  {
    path: '/suite/load-error',
    name: 'app-load-error',
    component: AppLoadErrorView,
    meta: { frame: 'none', scroll: 'content', allowGuest: true, title: 'Frappe Suite' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/shell/NotFoundView.vue'),
    meta: {
      frame: 'none',
      scroll: 'content',
      title: 'Frappe Suite',
    },
  },
]

export function areaPlaceholderNames(areaId: string): string[] {
  return canonicalRoutes
    .flatMap((route) => {
      const mappedValue = {
        name: String(route.name ?? ''),
        area: route.meta?.area,
      }
      return mappedValue.area === areaId && mappedValue.name.startsWith('area-placeholder-')
        ? [mappedValue]
        : []
    })
    .map((route) => route.name)
}

function defineAsyncRoute(loader: () => Promise<{ default: Component }>): Component {
  const AsyncComponent = defineAsyncComponent(loader)
  return defineComponent({
    name: 'AsyncRoute',
    setup: () => () => h(AsyncComponent),
  })
}
