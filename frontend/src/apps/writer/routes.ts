import type { RouteRecordRaw } from 'vue-router'

import { createResource } from 'frappe-ui'

// Boot side-effects that ran in the standalone app's main.ts / App.vue. The
// suite's shared main.ts does not run them, so trigger them on writer module
// load. Backend method paths preserved as-is.
import { allUsers } from '@/apps/drive/ui/drive/js/resources'

allUsers.fetch()

/**
 * Writer route module — mounted by the suite router under the '/writer' prefix.
 * Paths are RELATIVE to '/writer' (no leading slash; the empty-path child '' is
 * the app index). Route names are namespaced `writer-*` to avoid collisions in
 * the single suite router.
 *
 * Name mapping from the standalone app:
 *   Home     ('/')             -> writer-home       (Documents list, auth-gated)
 *   Document ('/w/:id/:slug?') -> writer-document   (guest-reachable, isPublic)
 *   Login    ('/login')        -> dropped (the suite auth gate redirects guests)
 *
 * All routes nest under WriterLayout, which provides the writer-local `inIframe`
 * injection, applies the persisted theme, and wraps views in FrappeUIProvider +
 * the FDialogs host (was the standalone App.vue).
 *
 * `writer-document` is marked `meta.isPublic` so the suite's auth guard lets
 * guests reach shared documents (the standalone Document route had `allowGuest`).
 * The standalone Home `beforeEnter` redirected logged-out users to /login; the
 * suite router's own `beforeEach` already does this for non-public routes.
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
        meta: { documentPage: true, isPublic: true },
      },
    ],
  },
]

export default routes

/* -------------------------------------------------------------------------- */
/* Translations                                                                */
/*                                                                             */
/* The suite installs ONE global translation plugin (foundation                */
/* src/boot/translation.ts) so bare `__('text')` works everywhere. We only     */
/* need to populate `window.translatedMessages`. The standalone app fetched     */
/* translations via `suite.drive.api.product.get_translations` — preserved as-is.    */
/* -------------------------------------------------------------------------- */

const translations = createResource({
  url: 'suite.drive.api.product.get_translations',
  cache: 'translations',
  transform: (data) => (window.translatedMessages = data),
})

if (!window.translatedMessages) translations.fetch()
