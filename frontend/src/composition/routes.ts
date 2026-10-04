import { defineAsyncComponent, defineComponent, h, type Component } from 'vue'
import type { RouteMeta, RouteRecordRaw } from 'vue-router'

import type { PhoneChromeOwner, ShellFrame } from '@/platform/contracts'

const calendarLogo = '/assets/suite/calendar/images/logo.svg'
const driveLogo = '/assets/suite/drive/images/logo.svg'
const mailLogo = '/assets/suite/mail/images/logo.svg'
const meetLogo = '/assets/suite/meet/images/meet.png'
const suiteLogo = '/assets/suite/frontend/logo.svg'

const RouteLoading = defineComponent({
  name: 'RouteLoading',
  setup: () => () => h('div', { class: 'h-full min-h-0 w-full min-w-0' }),
})

function areaMeta(
  area: string,
  title: string,
  favicon: string,
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
    favicon,
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
  placeholder('/home', 'area-placeholder-home', areaMeta('home', 'Home', suiteLogo)),
  placeholder('/drive', 'area-placeholder-files-root', areaMeta('files', 'My files', driveLogo)),
  placeholder(
    '/drive/organization',
    'area-placeholder-files-organization',
    areaMeta('files', 'Organization files', driveLogo),
  ),
  placeholder(
    '/drive/f/:node/:slug?',
    'area-placeholder-files-folder',
    areaMeta('files', 'Folder', driveLogo, { allowGuest: true }),
  ),
  placeholder(
    '/drive/recent',
    'area-placeholder-files-recent',
    areaMeta('files', 'Recent', driveLogo),
  ),
  placeholder(
    '/drive/starred',
    'area-placeholder-files-starred',
    areaMeta('files', 'Starred', driveLogo),
  ),
  placeholder(
    '/drive/shared-with-me',
    'area-placeholder-files-shared-with-me',
    areaMeta('files', 'Shared with me', driveLogo),
  ),
  placeholder(
    '/drive/trash',
    'area-placeholder-files-trash',
    areaMeta('files', 'Trash', driveLogo),
  ),
  // Mail owns its phone chrome by default: an open thread and the composer are
  // full screen. Its list pages ask the shell for its chrome through
  // `useShellPhoneChrome`. The area group copies this metadata, so every Mail
  // page inherits it.
  placeholder(
    '/mail/:pathMatch(.*)*',
    'area-placeholder-mail',
    areaMeta('mail', 'Mail', mailLogo, {
      scroll: 'content',
      phoneChrome: 'page',
    }),
  ),
  placeholder(
    '/calendar/:pathMatch(.*)*',
    'area-placeholder-calendar',
    areaMeta('calendar', 'Calendar', calendarLogo, { scroll: 'content' }),
  ),
  // One placeholder holds the whole prefix. A call (`/meet/:meetingId`) sets
  // its own frame `none` and admits guests in Meet's route module.
  placeholder(
    '/meet/:pathMatch(.*)*',
    'area-placeholder-meet',
    areaMeta('meet', 'Meet', meetLogo, { scroll: 'content' }),
  ),
  // The tab says "Opening…" until the document host names it after the node,
  // unless the opener named the node in the history entry (`openingTitleState`).
  placeholder(
    '/d/:node/:slug?',
    'document-host',
    areaMeta('files', 'Opening…', driveLogo, {
      scroll: 'content',
      allowGuest: true,
    }),
    defineAsyncRoute(() => import('@/composition/DocumentHost.vue')),
  ),
]

export const routes: RouteRecordRaw[] = [
  ...canonicalRoutes,
  {
    path: '/suite/setup',
    name: 'suite-setup',
    component: () => import('@/shell/SetupView.vue'),
    meta: {
      frame: 'none',
      scroll: 'content',
      title: 'Set up Frappe Suite',
      favicon: suiteLogo,
    },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/shell/NotFoundView.vue'),
    meta: {
      frame: 'none',
      scroll: 'content',
      title: 'Frappe Suite',
      favicon: suiteLogo,
    },
  },
]

export function areaPlaceholderNames(areaId: string): string[] {
  return canonicalRoutes
    .map((route) => ({
      name: String(route.name ?? ''),
      area: route.meta?.area,
    }))
    .filter((route) => route.area === areaId && route.name.startsWith('area-placeholder-'))
    .map((route) => route.name)
}

function defineAsyncRoute(loader: () => Promise<{ default: Component }>): Component {
  const AsyncComponent = defineAsyncComponent(loader)
  return defineComponent({
    name: 'AsyncRoute',
    setup: () => () => h(AsyncComponent),
  })
}
