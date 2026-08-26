import type { RouteRecordRaw } from 'vue-router'
import { createResource } from 'frappe-ui'

import { useSessionStore } from '@/boot/session'
import { translate } from '@/apps/drive/resources/files'
import { setupTheme } from '@/utils/setupTheme'

/**
 * Drive route module — mounted by the suite router under the '/drive' prefix.
 *
 * Paths are RELATIVE to '/drive' (no leading slash; the empty-path child '' is
 * the app index). Route names are namespaced `drive-*` to avoid collisions in
 * the single suite router.
 *
 * All routes nest under DriveLayout: it provides
 * the `emitter` and `socket` injections, the `inIframe` flag, renders the
 * sidebar / file-uploader / dialogs chrome, and wires global keyboard
 * shortcuts.
 *
 * Auth: the suite router's own `beforeEach` redirects guests to /login unless
 * the route is `meta.allowGuest` (publicly-shared files/folders).
 * Drive-specific guard behaviour (clearing active entity) lives in router.ts.
 */

const setPageTitle = (to: any) => {
  if (useSessionStore().isLoggedIn) {
    document.title = __(String(to.name).replace(/^drive-/, ''))
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
        meta: { allowGuest: true },
      },
      {
        path: '',
        name: 'drive-Home',
        component: () => import('@/apps/drive/pages/Personal.vue'),
        beforeEnter: [setPageTitle],
        props: true,
      },
      {
        path: 'inbox',
        name: 'drive-Inbox',
        component: () => import('@/apps/drive/pages/Notifications.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        path: 'recents',
        name: 'drive-Recents',
        component: () => import('@/apps/drive/pages/Recents.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        path: 'favourites',
        name: 'drive-Favourites',
        component: () => import('@/apps/drive/pages/Favourites.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        // Shared-with-you is a tab on Home now; old links still land somewhere real.
        path: 'shared',
        redirect: { name: 'drive-Home' },
      },
      {
        path: 'attachments/:doctype?/:docname?',
        name: 'drive-Attachments',
        props: true,
        component: () => import('@/apps/drive/pages/Attachments.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        path: 'documents',
        name: 'drive-Documents',
        component: () => import('@/apps/drive/pages/Documents.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        path: 'presentations',
        name: 'drive-Presentations',
        component: () => import('@/apps/drive/pages/Slides.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        path: 'trash',
        name: 'drive-Trash',
        component: () => import('@/apps/drive/pages/Trash.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        path: 'g/:entityName/',
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        meta: { allowGuest: true },
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
        path: 'f/:entityName/:slug?',
        name: 'drive-File',
        component: () => import('@/apps/drive/pages/File.vue'),
        meta: { allowGuest: true, filePage: true, shellScroll: false },
        props: true,
      },
      {
        path: 'd/:entityName/:slug?',
        name: 'drive-Folder',
        component: () => import('@/apps/drive/pages/Folder.vue'),
        meta: { allowGuest: true },
        props: true,
      },
      {
        path: 'w/:entityName/:slug?',
        name: 'drive-Document',
        meta: { allowGuest: true },
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        beforeEnter: (props) => {
          window.location.href = '/writer/w/' + props.params.entityName
        },
      },
      // old redirects
      {
        path: 'folder/:entityName',
        meta: { allowGuest: true },
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        beforeEnter: async (to) => {
          await translate.fetch({ old_name: to.params.entityName })
          return {
            name: 'drive-Folder',
            params: {
              // Untranslatable ids fall through so the page shows its error state
              entityName: translate.data || to.params.entityName,
            },
          }
        },
      },
      {
        path: 'document/:entityName',
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        meta: { allowGuest: true },
        beforeEnter: async (to) => {
          await translate.fetch({ old_name: to.params.entityName })
          return {
            name: 'drive-Document',
            params: {
              entityName: translate.data || to.params.entityName,
            },
          }
        },
      },
      {
        path: 'file/:entityName',
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        meta: { allowGuest: true },
        beforeEnter: async (to) => {
          await translate.fetch({ old_name: to.params.entityName })
          return {
            name: 'drive-File',
            params: {
              entityName: translate.data || to.params.entityName,
            },
          }
        },
      },
      {
        path: 't/:team/:letter/:entityName/:slug?',
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        meta: { allowGuest: true },
        beforeEnter: async (to) => {
          return {
            path: `/drive/g/${to.params.entityName}`,
          }
        },
      },
      {
        // Teams became folders. The id in the link belonged to the team, not the
        // folder it became, so it can only be resolved from what the migration
        // recorded — falling back to Home when there is nothing to point at, or
        // when the team was never theirs.
        path: 't/:team/',
        component: () => import('@/apps/drive/pages/Dummy.vue'),
        meta: { allowGuest: true },
        beforeEnter: async (to) => {
          const legacy = createResource({
            url: 'suite.drive.api.files.resolve_legacy_route',
          })
          const entity = await legacy.fetch({ old_id: to.params.team })
          if (!entity) return { name: 'drive-Home' }
          return {
            name: entity.is_folder ? 'drive-Folder' : 'drive-File',
            params: { entityName: entity.name },
          }
        },
      },
    ],
  },
]

export default routes

/* -------------------------------------------------------------------------- */
/* Boot side-effects the suite main.ts does not run, so trigger them on drive  */
/* module load.                                                                */
/* -------------------------------------------------------------------------- */

// Apply the persisted theme (can't gate the shared mount, so fire-and-forget).
setupTheme()

// The suite installs ONE global translation plugin so bare `__()` works. We
// only need to populate `window.translatedMessages`. Backend path preserved.
const translations = createResource({
  url: 'suite.drive.api.product.get_translations',
  cache: 'translations',
  transform: (data: unknown) => ((window as any).translatedMessages = data),
})
if (!(window as any).translatedMessages) translations.fetch()
