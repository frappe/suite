import type { RouteRecordRaw } from 'vue-router'

export const routes: RouteRecordRaw[] = [
  {
    path: '',
    name: 'home',
    component: () => import('@/composition/home/HomeArea.vue'),
    meta: {
      area: 'home',
      frame: 'shell',
      scroll: 'content',
      title: 'Home',
    },
  },
]
