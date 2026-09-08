import type { RouteRecordRaw } from 'vue-router'

/**
 * Sheets route module — mounted by the suite router under the '/sheets' prefix.
 *
 *   ''       -> sheets-home    (the listing)
 *   ':id'    -> sheets-editor  (the editor; 'new' creates a sheet)
 *
 * Paths are RELATIVE to '/sheets' (no leading slash; '' is the app index).
 * Route names are namespaced `sheets-*` to avoid collisions in the single suite
 * router. Views are lazy so the heavy editor deps (xlsx, echarts, yjs) stay
 * code-split out of the shared shell bundle.
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '',
    name: 'sheets-home',
    component: () => import('@/apps/sheets/pages/Home.vue'),
  },
  {
    path: 'trash',
    name: 'sheets-trash',
    component: () => import('@/apps/sheets/pages/Trash.vue'),
  },
  {
    path: ':id',
    name: 'sheets-editor',
    component: () => import('@/apps/sheets/pages/SheetEditor.vue'),
    props: true,
  },
]
