import type { RouteRecordRaw } from 'vue-router'

export const routes: RouteRecordRaw[] = [
  {
    path: '',
    name: 'draw-home',
    component: () => import('./Home.vue'),
  },
  {
    path: 'editor',
    name: 'draw-editor',
    component: () => import('./App.vue'),
  },
]
