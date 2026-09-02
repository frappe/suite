import type { RouteRecordRaw } from 'vue-router'

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
