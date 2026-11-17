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
    <!-- The directory below shows its own placeholder rows. -->
    <LocalUsers v-if="!onInvitations" embedded />
  </DashboardLayout>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'

import { api, useQuery } from '@/api'
import { loadMailAdminUsers } from '@/apps/mail'
import { DashboardLayout } from '@/platform/dashboard'
import { LoadFailed } from '@/platform/load-failed'
import { translate as __ } from '@/platform/translation'

import UsersTabs from './UsersTabs.vue'

const storage = useQuery(api.suite.storage.get)
const route = useRoute()
const MailUsers = defineAsyncComponent(loadMailAdminUsers)
const LocalUsers = defineAsyncComponent(() => import('./LocalUsersView.vue'))
const onInvitations = computed(() => route.path.endsWith('/invitations'))
</script>
