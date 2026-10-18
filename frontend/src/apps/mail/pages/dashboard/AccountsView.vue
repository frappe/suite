<template>
  <DashboardLayout
    area="mail"
    :breadcrumbs="[{ label: __('Invitations') }]"
    :button-label="__('Add Account')"
    :button-action="() => (showAddMember = true)"
    :remove-spacing="true"
  >
    <div class="flex min-h-0 flex-1 flex-col space-y-5 overflow-y-auto px-3 py-5 sm:px-5">
      <InvitesView ref="invitesView" />
    </div>
  </DashboardLayout>
  <AddAccountModal v-model="showAddMember" @reload="reload" />
</template>
<script setup lang="ts">
import { usePageMeta } from 'frappe-ui'
import { ref, useTemplateRef } from 'vue'

import AddAccountModal from '@/apps/mail/components/Modals/AddAccountModal.vue'
import InvitesView from '@/apps/mail/pages/dashboard/InvitesView.vue'
import { useAddOnArrival } from '@/apps/mail/utils/addOnArrival'
import { DashboardLayout } from '@/platform/dashboard'
import { appPageMeta } from '@/platform/page-meta'

usePageMeta(() => appPageMeta(__('Invitations'), 'Admin'))

// add/invite accounts

const showAddMember = ref(false)
useAddOnArrival(showAddMember)

const invitesView = useTemplateRef('invitesView')

const reload = () => {
  invitesView.value?.reloadInvites()
}
</script>
