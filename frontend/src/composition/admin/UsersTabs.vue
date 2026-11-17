<template>
  <TabButtons v-model="tab" :options="OPTIONS" />
</template>

<script setup lang="ts">
import { TabButtons } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { translate as __ } from '@/platform/translation'

const route = useRoute()
const router = useRouter()
// The tab is the URL: /admin/users or /admin/users/invitations.
const tab = computed({
  get: () => (route.path.endsWith('/invitations') ? 'invitations' : 'users'),
  set: (value) =>
    void router.push(value === 'invitations' ? '/admin/users/invitations' : '/admin/users'),
})
const OPTIONS = [
  { value: 'users', label: __('Users') },
  { value: 'invitations', label: __('Invitations') },
]
</script>
