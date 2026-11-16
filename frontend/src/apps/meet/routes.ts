import type { RouteRecordRaw } from 'vue-router'

// Meet's startup work runs when this module first loads (./runtime.ts).
import '@/apps/meet/runtime'

/**
 * Meet route module — mounted by the suite router under the '/meet' prefix.
 * Paths are RELATIVE to '/meet' (no leading slash; the empty-path child '' is
 * the app index). Route names are namespaced `meet-*` to avoid collisions in the
 * single suite router.
 *
 * All routes nest under MeetLayout, which opens the socket connection and
 * closes it on unmount, provides the meet-local `$platform`, and hosts the
 * shortcuts dialog. The platform provides the one FrappeUIProvider.
 *
 * `meet-meeting` is marked `meta.allowGuest` so the suite's auth guard lets
 * guests join meetings, and `meta.frame: "none"` so a call never shows the
 * shell. The other routes take their frame from the Meet area group.
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '',
    component: () => import('@/apps/meet/pages/MeetLayout.vue'),
    children: [
      {
        path: 'scheduled',
        name: 'meet-scheduled',
        redirect: { name: 'meet-home' },
      },
      {
        path: 'recordings',
        redirect: { name: 'meet-home' },
      },
      {
        path: '',
        name: 'meet-home',
        component: () => import('@/apps/meet/pages/Home.vue'),
      },
      {
        path: ':meetingId',
        name: 'meet-meeting',
        component: () => import('@/apps/meet/pages/Meeting.vue'),
        // A call stays outside the shell: fixed, dark, full screen [T010].
        meta: { allowGuest: true, frame: 'none' },
      },
    ],
  },
]
