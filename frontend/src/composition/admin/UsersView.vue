<template>
  <MailUsers v-if="storage.data?.cloud">
    <template #tabs><UsersTabs /></template>
    <template #users>
      <LocalUsers
        embedded
        :status="route.query.status"
        :initial-transfer-user="
          route.query.action === 'transfer' && typeof route.query.user === 'string'
            ? route.query.user
            : undefined
        "
      >
        <template #lead><UsersTabs /></template>
      </LocalUsers>
    </template>
  </MailUsers>
  <LocalUsers v-else-if="storage.data" />
  <LoadFailed
    v-else-if="storage.status === 'error'"
    :title="__('Could not load users')"
    :retry="() => storage.refetch()"
  />
  <DashboardLayout v-else area="admin" :breadcrumbs="[{ label: __('Users') }]">
    <!-- Mount the directory once the instance-specific layout is ready. -->
    <template v-if="onInvitations">
      <UsersTabs />
      <DashboardListSkeleton :columns="3" />
    </template>
    <DashboardListSkeleton v-else :columns="4" />
  </DashboardLayout>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, h } from 'vue'
import { useRoute } from 'vue-router'

import { api, useQuery } from '@/api'
import { loadMailAdminUsers } from '@/apps/mail'
import { DashboardLayout, DashboardListSkeleton } from '@/platform/dashboard'
import { LoadFailed } from '@/platform/load-failed'
import { translate as __ } from '@/platform/translation'

import UsersTabs from './UsersTabs.vue'

const storage = useQuery(api.suite.storage.get)
const route = useRoute()
const onInvitations = computed(() => route.path.endsWith('/invitations'))
// Keep the directory request alive as the cloud layout replaces its loading view.
useQuery(api.suite.users.list, () => (onInvitations.value ? false : {}))
// Keep the dashboard header mounted while the cloud-only chunk loads: its
// teleported header reserves space in the shell outside this component.
const MailUsers = defineAsyncComponent({
  loader: loadMailAdminUsers,
  delay: 0,
  loadingComponent: {
    render: () =>
      h(
        DashboardLayout,
        { area: 'admin', breadcrumbs: [{ label: __('Users') }] },
        {
          default: () =>
            onInvitations.value
              ? [h(UsersTabs), h(DashboardListSkeleton, { columns: 3 })]
              : h(DashboardListSkeleton, { columns: 4 }),
        },
      ),
  },
})
const LocalUsers = defineAsyncComponent(() => import('./LocalUsersView.vue'))
</script>
