<template>
  <DashboardLayout area="admin" :breadcrumbs="[{ label: __('Users') }]">
    <template #actions>
      <Button variant="solid" :label="__('Add user')" @click="adding = true" />
    </template>
    <Tabs v-model="tab" :tabs="tabs">
      <template #tab-panel>
        <div class="flex min-h-0 flex-1 flex-col gap-5 pt-5">
          <ErrorMessage v-if="tab === 'users'" :message="users.error?.message" />
          <Alert
            v-if="tab === 'users' && onlyActiveAdmin"
            theme="amber"
            :title="__('Only one active Admin')"
            :description="
              __('Make another user an Admin so someone else can manage the workspace.')
            "
          />
          <section
            v-if="tab === 'users' && failedUsers.length"
            class="space-y-3"
            :aria-label="__('User accounts needing attention')"
          >
            <Alert
              v-for="user in failedUsers"
              :key="user.name"
              class="account-alert"
              theme="red"
              :title="
                user.setup_status === 'Setup failed'
                  ? __('{0}: Mail account setup failed', [user.full_name])
                  : __('{0}: Mail deletion needs a retry', [user.full_name])
              "
              :description="user.account || user.email"
            >
              <template v-if="user.account" #actions>
                <Button
                  variant="ghost"
                  :label="__('Review account')"
                  :route="`/admin/mail/accounts/${encodeURIComponent(user.account)}`"
                />
              </template>
            </Alert>
          </section>
          <slot v-if="tab === 'users'" name="users" />
          <InvitesView v-else ref="invitations" />
        </div>
      </template>
    </Tabs>
  </DashboardLayout>
  <AddAccountModal v-model="adding" @reload="reload" />
</template>

<script setup lang="ts">
import { Alert, Button, ErrorMessage, Tabs } from 'frappe-ui'
import { computed, nextTick, ref, useTemplateRef } from 'vue'

import { api, useQuery } from '@/api'
import AddAccountModal from '@/apps/mail/components/Modals/AddAccountModal.vue'
import InvitesView from '@/apps/mail/pages/dashboard/InvitesView.vue'
import { useAddOnArrival } from '@/apps/mail/utils/addOnArrival'
import { DashboardLayout } from '@/platform/dashboard'
import { translate as __ } from '@/platform/translation'

// Suite composition supplies its preserved-identity directory; Mail owns invitations (§4.3).
defineSlots<{ users: () => unknown }>()

const tab = ref<'users' | 'invitations'>('users')
const users = useQuery(api.suite.users.list)
const onlyActiveAdmin = computed(
  () =>
    !users.error &&
    users.data?.filter((user) => user.enabled).length === 1 &&
    users.data?.some((user) => user.enabled && user.is_admin),
)
const failedUsers = computed(() =>
  (users.data ?? []).filter(
    (user) => user.setup_status === 'Setup failed' || user.setup_status === 'Deletion failed',
  ),
)
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

<style scoped>
.account-alert[data-color='red'] {
  background-color: var(--surface-red-2);
}
</style>
