/** Mail-owned administration surfaces mounted by Suite Admin, never under /mail/dashboard. */
import type { RouteRecordRaw } from 'vue-router'

import '@/apps/mail/runtime'

export const routes: RouteRecordRaw[] = [
  {
    path: 'mail',
    component: () => import('@/apps/mail/pages/AdminLayout.vue'),
    meta: { isDashboard: true, area: 'admin' },
    children: [
      {
        path: 'domains',
        name: 'mail-domains',
        component: () => import('@/apps/mail/pages/dashboard/DomainsView.vue'),
      },
      {
        path: 'domains/:domainId',
        name: 'mail-domain',
        component: () => import('@/apps/mail/pages/dashboard/DomainView.vue'),
        props: true,
      },
      {
        path: 'groups',
        name: 'mail-groups',
        component: () => import('@/apps/mail/pages/dashboard/GroupsView.vue'),
      },
      {
        path: 'groups/:groupId',
        name: 'mail-group',
        component: () => import('@/apps/mail/pages/dashboard/GroupView.vue'),
        props: true,
      },
      {
        path: 'mailing-lists',
        name: 'mail-mailing-lists',
        component: () => import('@/apps/mail/pages/dashboard/MailingListsView.vue'),
      },
      {
        path: 'mailing-lists/:listId',
        name: 'mail-mailing-list',
        component: () => import('@/apps/mail/pages/dashboard/MailingListView.vue'),
        props: true,
      },
      {
        path: 'dmarc',
        name: 'mail-dmarc-reports',
        component: () => import('@/apps/mail/pages/dashboard/DmarcReportsView.vue'),
      },
      {
        path: 'dmarc/:reportId',
        name: 'mail-dmarc-report',
        component: () => import('@/apps/mail/pages/dashboard/DmarcReportView.vue'),
        props: true,
      },
      {
        path: 'tls',
        name: 'mail-tls-reports',
        component: () => import('@/apps/mail/pages/dashboard/TlsReportsView.vue'),
      },
      {
        path: 'tls/:reportId',
        name: 'mail-tls-report',
        component: () => import('@/apps/mail/pages/dashboard/TlsReportView.vue'),
        props: true,
      },
      {
        path: 'accounts/:accountId',
        name: 'mail-account',
        component: () => import('@/apps/mail/pages/dashboard/AccountView.vue'),
        props: true,
      },
      {
        path: 'invitations',
        name: 'mail-invites',
        component: () => import('@/apps/mail/pages/dashboard/AccountsView.vue'),
      },
    ],
  },
]
