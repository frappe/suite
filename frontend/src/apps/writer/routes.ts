import type { RouteRecordRaw } from 'vue-router'

import { createResource } from 'frappe-ui'

// Boot side-effects the suite's shared main.ts does not run, so trigger them
// on writer module load.
import { allUsers } from '@/apps/drive/legacy/sdk'
import { getSessionUser } from '@/boot/session'

if (getSessionUser()) allUsers.fetch()

/**
 * Writer route module — mounted by the suite router under the '/writer' prefix.
 * Paths are RELATIVE to '/writer' (no leading slash; the empty-path child '' is
 * the app index). Route names are namespaced `writer-*` to avoid collisions in
 * the single suite router.
 *
 * All routes nest under WriterLayout, which provides the writer-local `inIframe`
 * injection, applies the persisted theme, and wraps views in FrappeUIProvider +
 * the FDialogs host.
 *
 * `writer-document` is marked `meta.allowGuest` so the suite's auth guard lets
 * guests reach shared documents.
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '',
    component: () => import('@/apps/writer/pages/WriterLayout.vue'),
    children: [
      {
        path: '',
        name: 'writer-home',
        component: () => import('@/apps/writer/pages/Documents.vue'),
      },
      {
        path: 'w/:id/:slug?',
        name: 'writer-document',
        component: () => import('@/apps/writer/pages/Document.vue'),
        props: true,
        meta: { documentPage: true, allowGuest: true },
      },
    ],
  },
]

export default routes

const translations = createResource({
  url: 'suite.drive.api.product.get_translations',
  cache: 'translations',
  transform: (data) => (window.translatedMessages = data),
})

if (!window.translatedMessages) translations.fetch()
