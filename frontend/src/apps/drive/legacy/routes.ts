import type { RouteRecordRaw } from 'vue-router'
import { createResource } from 'frappe-ui'

import { node } from '@/apps/drive/client/nodes'
import { useSessionStore } from '@/boot/session'
import { TransportError, transport } from '@/platform/transport'
import { appDocumentTitle } from '@/utils/documentTitle'
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
    document.title = appDocumentTitle(__(String(to.name).replace(/^drive-/, '')), 'Drive')
  }
}

const redirectLegacyEntity = async (to: any, name: string) => {
  const { translate } = await import('@/apps/drive/legacy/resources/files')
  await translate.fetch({ old_name: to.params.entityName })
  return {
    name,
    params: { entityName: translate.data || to.params.entityName },
  }
}

// The last failed `/drive/g/<id>` read, in the shape the old error page reads.
let nodeReadError: { exc_type: string; messages: string[] } | null = null

function asOldDriveError(error: unknown): { exc_type: string; messages: string[] } {
  const status = error instanceof TransportError ? error.status : 0
  const message = error instanceof Error ? error.message : String(error)
  // The old page sends a guest to log in on a PermissionError.
  const refused = status === 401 || status === 403
  return { exc_type: refused ? 'PermissionError' : 'DoesNotExistError', messages: [message] }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '',
    component: () => import('@/apps/drive/legacy/pages/DriveLayout.vue'),
    children: [
      {
        path: 'signup',
        name: 'drive-Signup',
        component: () => import('@/apps/drive/legacy/pages/Signup.vue'),
        beforeEnter: () => {
          if (useSessionStore().isLoggedIn) return { name: 'drive-Home' }
        },
        meta: { allowGuest: true },
      },
      {
        path: '',
        name: 'drive-Home',
        component: () => import('@/apps/drive/legacy/pages/Personal.vue'),
        beforeEnter: [setPageTitle],
        props: true,
      },
      {
        path: 'inbox',
        name: 'drive-Inbox',
        component: () => import('@/apps/drive/legacy/pages/Notifications.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        path: 'recents',
        name: 'drive-Recents',
        component: () => import('@/apps/drive/legacy/pages/Recents.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        path: 'favourites',
        name: 'drive-Favourites',
        component: () => import('@/apps/drive/legacy/pages/Favourites.vue'),
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
        component: () => import('@/apps/drive/legacy/pages/Attachments.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        path: 'documents',
        name: 'drive-Documents',
        component: () => import('@/apps/drive/legacy/pages/Documents.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        path: 'presentations',
        name: 'drive-Presentations',
        component: () => import('@/apps/drive/legacy/pages/Slides.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        path: 'trash',
        name: 'drive-Trash',
        component: () => import('@/apps/drive/legacy/pages/Trash.vue'),
        beforeEnter: [setPageTitle],
      },
      {
        // vue-router skips a record with no name, no component and no
        // redirect, so without a name this address showed Not Found.
        // `node_url` writes it for every kind while the files flip is off.
        // It opens each kind on the page the old Drive list opens it on. A
        // failed read guesses nothing: the old error page shows it here.
        path: 'g/:entityName/',
        name: 'drive-Node',
        meta: { allowGuest: true },
        component: () => import('@/apps/drive/legacy/components/ErrorPage.vue'),
        props: () => ({ error: nodeReadError }),
        beforeEnter: async (to) => {
          const id = String(to.params.entityName)
          let entity
          try {
            entity = await transport.request(node(id).operation, { node: id })
          } catch (error) {
            nodeReadError = asOldDriveError(error)
            return true
          }
          const keep = { query: to.query, hash: to.hash, replace: true }
          if (entity.kind === 'folder' || entity.kind === 'root')
            return { path: `/drive/d/${entity.name}`, ...keep }
          if (entity.content_doctype === 'Writer Document')
            return { path: `/writer/w/${entity.name}`, ...keep }
          if (entity.content_doctype === 'Sheet' && entity.content_docname)
            return { path: `/sheets/${entity.content_docname}`, ...keep }
          if (entity.content_doctype === 'Presentation' && entity.content_docname)
            return { path: `/slides/presentation/${entity.content_docname}`, ...keep }
          return { path: `/drive/f/${entity.name}`, ...keep }
        },
      },
      {
        path: 'f/:entityName/:slug?',
        name: 'drive-File',
        component: () => import('@/apps/drive/legacy/pages/File.vue'),
        meta: { allowGuest: true, filePage: true, shellScroll: false },
        props: true,
        // The server writes folder links as `/drive/f/<id>` once the files flip
        // is on. With the flip off again those links still open the folder.
        // A failed read opens the file page, whose error page sends a guest to
        // log in.
        beforeEnter: async (to) => {
          const id = String(to.params.entityName)
          const entity = await transport.request(node(id).operation, { node: id }).catch(() => null)
          if (entity?.kind !== 'folder') return true
          return { path: `/drive/d/${entity.name}`, query: to.query, hash: to.hash, replace: true }
        },
      },
      {
        path: 'd/:entityName/:slug?',
        name: 'drive-Folder',
        component: () => import('@/apps/drive/legacy/pages/Folder.vue'),
        meta: { allowGuest: true },
        props: true,
      },
      {
        path: 'w/:entityName/:slug?',
        name: 'drive-Document',
        meta: { allowGuest: true },
        redirect: (to) => ({
          name: 'writer-document',
          params: { id: to.params.entityName, slug: to.params.slug },
        }),
      },
      // old redirects
      {
        path: 'folder/:entityName',
        meta: { allowGuest: true },
        beforeEnter: (to) => redirectLegacyEntity(to, 'drive-Folder'),
      },
      {
        path: 'document/:entityName',
        meta: { allowGuest: true },
        beforeEnter: (to) => redirectLegacyEntity(to, 'drive-Document'),
      },
      {
        path: 'file/:entityName',
        meta: { allowGuest: true },
        beforeEnter: (to) => redirectLegacyEntity(to, 'drive-File'),
      },
      {
        path: 't/:team/:letter/:entityName/:slug?',
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

setupTheme()

const translations = createResource({
  url: 'suite.drive.api.product.get_translations',
  cache: 'translations',
  transform: (data: unknown) => ((window as any).translatedMessages = data),
})
if (!(window as any).translatedMessages) translations.fetch()
