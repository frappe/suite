import type { RouteMeta, RouteRecordRaw } from 'vue-router'

const favicon = '/assets/suite/drive/images/logo.svg'

function meta(title: string, allowGuest = false): RouteMeta {
  return { area: 'files', frame: 'area', scroll: 'shell', allowGuest, title, favicon }
}

export const routes: RouteRecordRaw[] = [
  { path: '', name: 'files', component: () => import('./FilesPage.vue'), props: { destination: 'personal' }, meta: meta('My files') },
  { path: 'organization', name: 'files-organization', component: () => import('./FilesPage.vue'), props: { destination: 'organization' }, meta: meta('Organization files') },
  { path: 'f/:node/:slug?', name: 'files-folder', component: () => import('./FilesPage.vue'), props: { destination: 'folder' }, meta: meta('Folder', true) },
  { path: 'shared-with-me', name: 'files-shared-with-me', component: () => import('./FilesPage.vue'), props: { destination: 'shared' }, meta: meta('Shared with me') },
  { path: 'recent', name: 'files-recent', component: () => import('./FilesPage.vue'), props: { destination: 'recent' }, meta: meta('Recent') },
  { path: 'starred', name: 'files-starred', component: () => import('./FilesPage.vue'), props: { destination: 'starred' }, meta: meta('Starred') },
  { path: 'trash', name: 'files-trash', component: () => import('./FilesPage.vue'), props: { destination: 'trash' }, meta: meta('Trash') },
]

