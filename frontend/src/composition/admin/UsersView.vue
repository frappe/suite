<template>
  <MailUsers v-if="storage.data?.cloud">
    <template #users
      ><LocalUsers
        embedded
        :status="route.query.status"
        :initial-transfer-user="
          route.query.action === 'transfer' && typeof route.query.user === 'string'
            ? route.query.user
            : undefined
        "
    /></template>
  </MailUsers>
  <LocalUsers v-else-if="storage.data" />
  <ErrorMessage v-else-if="storage.error" :message="storage.error.message" />
  <DashboardLayout v-else area="admin" :breadcrumbs="[{ label: __('Users') }]">
    <!-- Same tabs as the Mail users page; the directory below shows its own placeholder rows. -->
    <Tabs
      :model-value="onInvitations ? 'invitations' : 'users'"
      :tabs="SKELETON_TABS"
      class="pointer-events-none"
    >
      <template #tab-panel>
        <div class="flex min-h-0 flex-1 flex-col gap-5 pt-5">
          <LocalUsers v-if="!onInvitations" embedded />
        </div>
      </template>
    </Tabs>
  </DashboardLayout>
</template>

<script setup lang="ts">
import { ErrorMessage, Tabs } from 'frappe-ui'
import { computed, defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'

import { api, useQuery } from '@/api'
import { loadMailAdminUsers } from '@/apps/mail'
import { DashboardLayout } from '@/platform/dashboard'
import { translate as __ } from '@/platform/translation'

const storage = useQuery(api.suite.storage.get)
const route = useRoute()
const MailUsers = defineAsyncComponent(loadMailAdminUsers)
const LocalUsers = defineAsyncComponent(() => import('./LocalUsersView.vue'))
const onInvitations = computed(() => route.path.endsWith('/invitations'))
const SKELETON_TABS = [
  { value: 'users', label: __('Users') },
  { value: 'invitations', label: __('Invitations') },
]
</script>
