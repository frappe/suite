<template>
  <DashboardLayout area="admin" :breadcrumbs="[{ label: __('Users') }]">
    <template #actions>
      <Button variant="solid" :label="__('Add user')" @click="adding = true" />
    </template>
    <Tabs v-model="tab" :tabs="tabs">
      <template #tab-panel>
        <div class="flex min-h-0 flex-1 flex-col gap-5 pt-5">
          <UsersView v-if="tab === 'users'" />
          <InvitesView v-else ref="invitations" />
        </div>
      </template>
    </Tabs>
  </DashboardLayout>
  <AddAccountModal v-model="adding" @reload="reload" />
</template>

<script setup lang="ts">
import { Button, Tabs } from 'frappe-ui'
import { nextTick, ref, useTemplateRef } from 'vue'

import AddAccountModal from '@/apps/mail/components/Modals/AddAccountModal.vue'
import InvitesView from '@/apps/mail/pages/dashboard/InvitesView.vue'
import UsersView from '@/apps/mail/pages/dashboard/UsersView.vue'
import { useAddOnArrival } from '@/apps/mail/utils/addOnArrival'
import { DashboardLayout } from '@/platform/dashboard'
import { translate as __ } from '@/platform/translation'

const tab = ref<'users' | 'invitations'>('users')
const tabs = [
  { value: 'users', label: __('Users') },
  { value: 'invitations', label: __('Invitations') },
]
const adding = ref(false)
useAddOnArrival(adding)
const invitations = useTemplateRef('invitations')
async function reload() {
  tab.value = 'invitations'
  await nextTick()
  await invitations.value?.reloadInvites()
}
</script>
