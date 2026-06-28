import type { RouteRecordRaw } from 'vue-router'
import { createResource } from 'frappe-ui'

import { useSessionStore } from '@/boot/session'
import {
  pageBreadcrumbs,
  setPageBreadcrumbs,
} from '@/apps/drive/data/breadcrumbs'
import { translate } from '@/apps/drive/resources/files'
import { setupTheme } from '@/apps/drive/utils/setupTheme'

/**
 * Drive route module — mounted by the suite router under the '/drive' prefix.
 *
 * Paths are RELATIVE to '/drive' (no leading slash; the empty-path child '' is
 * the app index). Route names are namespaced `drive-*` to avoid collisions in
 * the single suite router. Backend method paths preserved as-is.
 *
 * All routes nest under DriveLayout (was the standalone App.vue): it provides
 * the `emitter` and `socket` injections, the `inIframe` flag, renders the
 * sidebar / file-uploader / dialogs chrome, and wires global keyboard
 * shortcuts.
 *
 * Auth: the suite router's own `beforeEach` redirects guests to /login unless
 * the route is `meta.isPublic`. The standalone app used `meta.allowGuest` for
 * publicly-shared files/folders/teams — those become `meta.isPublic` here.
 * Drive-specific guard behaviour (recentTeam, clearing active entity) lives in
 * router.ts.
 */

const manageBreadcrumbs = (to: any) => {
  if (
    pageBreadcrumbs.value[pageBreadcrumbs.value.length - 1]?.name !==
    to.params.entityName
  ) {
    setPageBreadcrumbs({ loading: true, name: to.params.entityName })
  }
}

const setRootBreadCrumb = (to: any) => {
  if (useSessionStore().isLoggedIn) {
    document.title = __(String(to.name).replace(/^drive-/, ''))
    if (to.name !== 'drive-Team')
      setPageBreadcrumbs([
        {
          label: __(String(to.name).replace(/^drive-/, '')),
          name: to.name,
          route: to.path,
        },
      ])
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '',
    component: () => import('@/apps/drive/pages/DriveLayout.vue'),
    children: [
      {
        path: 'signup',
        name: 'drive-Signup',
        component: () => import('@/apps/drive/pages/Signup.vue'),
        beforeEnter: () => {
          if (useSessionStore().isLoggedIn) return { name: 'drive-Home' }
        },
        meta: { isPublic: true },
      },
      {
        path: 'setup',
        name: 'drive-Setup',
        component: () => import('@/apps/drive/pages/Setup.vue'),
      },
      {
        path: '',
        name: 'drive-Home',
        component: () => import('@/apps/drive/pages/Personal.vue'),
        beforeEnter: [setRootBreadCrumb],
        props: true,
      },
      {
        path: 'inbox',
        name: 'drive-Inbox',
        component: () => import('@/apps/drive/pages/Notifications.vue'),
        beforeEnter: [setRootBreadCrumb],
      },
      {
        path: 'teams',
        name: 'drive-Teams',
        component: () => import('@/apps/drive/pages/Teams.vue'),
      },
      {
        path: 'recents',
        name: 'drive-Recents',
        component: () => import('@/apps/drive/pages/Recents.vue'),
        beforeEnter: [setRootBreadCrumb],
      },
      {
        path: 'favourites',
        name: 'drive-Favourites',
        component: () => import('@/apps/drive/pages/Favourites.vue'),
        beforeEnter: [setRootBreadCrumb],
      },
      {
        path: 'shared',
        name: 'drive-Shared',
        component: () => import('@/apps/drive/pages/Shared.vue'),
        beforeEnter: [setRootBreadCrumb],
      },
      {
        path: 'attachments/:doctype?/:docname?',
        name: 'drive-Attachments',
        props: true,
        component: () => import('@/apps/drive/pages/Attachments.vue'),
        beforeEnter: [setRootBreadCrumb],
      },
      {
        path: 'documents',
        name: 'drive-Documents',
        component: () => import('@/apps/drive/pages/Documents.vue'),
        beforeEnter: [setRootBreadCrumb],
      },
      {
        path: 'presentations',
        name: 'drive-Presentations',
        component: () => import('@/apps/drive/pages/Slides.vue'),
        beforeEnter: [setRootBreadCrumb],
      },
      {
        path: 'trash',
        name: 'drive-Trash',
        component: () => import('@/apps/drive/pages/Trash.vue'),
        beforeEnter: [setRootBreadCrumb],
      },
      {
        path: 'g/:entityName/',
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        meta: { isPublic: true },
        beforeEnter: async (to) => {
          const entity = createResource({
            url: '/api/method/suite.drive.api.files.get_entity_type',
            method: 'GET',
            params: {
              entity_name: to.params.entityName,
            },
          })
          await entity.fetch()
          const letter = (
            {
              folder: 'd',
              file: 'f',
            } as Record<string, string>
          )[entity.data.type]
          return {
            path: `/drive/${letter}/${entity.data.name}`,
          }
        },
      },
      {
        path: 't/:team/',
        name: 'drive-Team',
        component: () => import('@/apps/drive/pages/Team.vue'),
        beforeEnter: [setRootBreadCrumb],
        props: true,
        meta: { isPublic: true },
      },
      {
        path: 'f/:entityName/:slug?',
        name: 'drive-File',
        component: () => import('@/apps/drive/pages/File.vue'),
        meta: { isPublic: true, filePage: true },
        beforeEnter: [manageBreadcrumbs],
        props: true,
      },
      {
        path: 'd/:entityName/:slug?',
        name: 'drive-Folder',
        component: () => import('@/apps/drive/pages/Folder.vue'),
        meta: { isPublic: true },
        beforeEnter: [manageBreadcrumbs],
        props: true,
      },
      {
        path: 'w/:entityName/:slug?',
        name: 'drive-Document',
        meta: { isPublic: true },
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        beforeEnter: (props) => {
          window.location.href = '/writer/w/' + props.params.entityName
        },
      },
      // old redirects
      {
        path: 'folder/:entityName',
        meta: { isPublic: true },
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        beforeEnter: async (to) => {
          await translate.fetch({ old_name: to.params.entityName })
          return {
            name: 'drive-Folder',
            params: {
              entityName: translate.data,
            },
          }
        },
      },
      {
        path: 'document/:entityName',
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        meta: { isPublic: true },
        beforeEnter: async (to) => {
          await translate.fetch({ old_name: to.params.entityName })
          return {
            name: 'drive-Document',
            params: {
              entityName: translate.data,
            },
          }
        },
      },
      {
        path: 'file/:entityName',
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        meta: { isPublic: true },
        beforeEnter: async (to) => {
          await translate.fetch({ old_name: to.params.entityName })
          return {
            name: 'drive-File',
            params: {
              entityName: translate.data,
            },
          }
        },
      },
      {
        path: 't/:team/:letter/:entityName/:slug?',
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        meta: { isPublic: true },
        beforeEnter: async (to) => {
          return {
            path: `/drive/g/${to.params.entityName}`,
          }
        },
      },
    ],
  },
]

export default routes

/* -------------------------------------------------------------------------- */
/* Boot side-effects (ran in the standalone main.ts; the suite main.ts does    */
/* not run them, so trigger them on drive module load).                        */
/* -------------------------------------------------------------------------- */

// Apply the persisted theme (was `setupTheme().then(app.mount)` — can't gate
// the shared mount, so fire-and-forget here).
setupTheme()

// The suite installs ONE global translation plugin so bare `__()` works. We
// only need to populate `window.translatedMessages`. Backend path preserved.
const translations = createResource({
  url: 'suite.drive.api.product.get_translations',
  cache: 'translations',
  transform: (data: unknown) => ((window as any).translatedMessages = data),
})
if (!(window as any).translatedMessages) translations.fetch()
