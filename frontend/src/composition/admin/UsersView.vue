<template>
  <MailUsers v-if="storage.data?.cloud" />
  <LocalUsers v-else-if="storage.data" />
  <ErrorMessage v-else-if="storage.error" :message="storage.error.message" />
  <DashboardLayout v-else area="admin" :breadcrumbs="[{ label: __('Users') }]" loading />
</template>

<script setup lang="ts">
import { ErrorMessage } from 'frappe-ui'
import { defineAsyncComponent } from 'vue'

import { api, useQuery } from '@/api'
import { loadMailAdminUsers } from '@/apps/mail'
import { DashboardLayout } from '@/platform/dashboard'
import { translate as __ } from '@/platform/translation'

const storage = useQuery(api.suite.storage.get)
const MailUsers = defineAsyncComponent(loadMailAdminUsers)
const LocalUsers = defineAsyncComponent(() => import('./LocalUsersView.vue'))
</script>
