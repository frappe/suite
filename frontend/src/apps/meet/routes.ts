import type { RouteRecordRaw } from 'vue-router'

import '@/apps/meet/runtime'

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
        meta: { allowGuest: true, frame: 'none' },
      },
    ],
  },
]
