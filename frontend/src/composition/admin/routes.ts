import type { RouteRecordRaw } from 'vue-router'

import { loadMailAdminRoutes } from '@/apps/mail'

const mail = await loadMailAdminRoutes()

export const routes: RouteRecordRaw[] = [
  {
    path: '',
    component: () => import('./AdminLayout.vue'),
    children: [
      { path: '', name: 'admin-overview', component: () => import('./OverviewView.vue') },
      { path: 'users', name: 'mail-accounts', component: () => import('./UsersView.vue') },
      { path: 'storage', name: 'admin-storage', component: () => import('./StorageView.vue') },
      { path: 'settings', name: 'admin-settings', component: () => import('./SettingsView.vue') },
      ...mail.routes,
    ],
  },
]
