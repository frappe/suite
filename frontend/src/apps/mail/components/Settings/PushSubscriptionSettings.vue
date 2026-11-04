<template>
  <AppSettingsHeader :title="__('Push Subscriptions')">
    <template #actions>
      <Button
        variant="outline"
        icon="lucide-refresh-cw"
        :tooltip="__('Refresh')"
        :loading="pushSubscriptions.isFetching"
        @click="pushSubscriptions.refetch().catch(() => {})"
      />
      <Button icon-left="lucide-plus" :label="__('New')" @click="showAddModal = true" />
    </template>
  </AppSettingsHeader>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-[4.4rem] pb-8 pt-6">
    <template v-if="rows.length">
      <div class="relative min-h-0 flex-1">
        <!-- Force ListView root to full panel height so overflow-x scrollbar is at the bottom -->
        <div
          class="absolute inset-0 flex min-h-0 flex-col overflow-hidden [&>div]:h-full [&>div]:min-h-0"
        >
          <ListView
            ref="listView"
            class="h-full min-h-0"
            :columns="COLUMNS"
            :rows="rows"
            row-key="name"
          >
            <ListHeader />
            <ListRows />
            <ListSelectBanner>
              <template #actions>
                <Button
                  variant="ghost"
                  :label="__('Renew')"
                  :loading="renewing"
                  @click="renewSelected"
                />
                <Button
                  variant="ghost"
                  theme="red"
                  :label="__('Delete')"
                  @click="showDeleteModal = true"
                />
              </template>
            </ListSelectBanner>
          </ListView>
        </div>
      </div>
    </template>
    <div
      v-else-if="!pushSubscriptions.isFetching"
      class="text-ink-gray-6 flex flex-col space-y-2 text-sm"
    >
      <p class="text-base font-medium">{{ __('No push subscriptions.') }}</p>
      <p>{{ MESSAGE }}</p>
    </div>

    <AddPushSubscriptionModal
      v-model="showAddModal"
      @created="pushSubscriptions.refetch().catch(() => {})"
    />
    <Dialog v-model:open="showDeleteModal" v-bind="deleteModalOptions" />
  </div>
</template>

<script setup lang="ts">
import { Button, Dialog } from 'frappe-ui'
import { ListHeader, ListRows, ListSelectBanner, ListView } from 'frappe-ui/experimental'
import { computed, inject, ref, useTemplateRef } from 'vue'

import { api, client, useMutation, useQuery, type InputOf } from '@/api'
import AddPushSubscriptionModal from '@/apps/mail/components/Modals/AddPushSubscriptionModal.vue'
import type { PushSubscription } from '@/apps/mail/types'
import { raiseError, raiseToast } from '@/apps/mail/utils'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

const user = inject('$user')
const dayjs = inject('$dayjs')
const listViewRef = useTemplateRef('listView')
const showAddModal = ref(false)
const showDeleteModal = ref(false)
const renewing = ref(false)

// Push subscriptions are user-scoped (not account-scoped), so they're fetched here rather than from the
// account store. A high limit keeps this a single request — a user has at most a handful of devices.
const pushSubscriptions = useQuery(api.mail.push.list, () => ({
  user: user.data.name,
  limit: 100,
}))

// `types` arrives as a pretty-printed JSON array string; render it as a compact comma-separated list.
const formatTypes = (types: string) => {
  try {
    const parsed = JSON.parse(types)
    return Array.isArray(parsed) && parsed.length ? parsed.join(', ') : '—'
  } catch {
    return '—'
  }
}
const rows = computed(() =>
  (pushSubscriptions.data ?? []).map((sub: PushSubscription) => ({
    name: sub.name,
    user: sub.user,
    id: sub.id,
    device_client_id: sub.device_client_id,
    types: formatTypes(sub.types),
    expires: sub.expires ? dayjs(sub.expires).format('D MMM YYYY, h:mm A') : '—',
  })),
)
const selectedNames = () => Array.from(listViewRef.value?.selections ?? []) as string[]
const selectedRows = () => {
  const names = new Set(selectedNames())
  return (pushSubscriptions.data ?? []).filter((s: PushSubscription) => names.has(s.name))
}

// Renew has no batch endpoint, so renew each selected subscription in turn. A subscription renewal
// extends its `expires` time on the JMAP server.
const renewSelected = async () => {
  const rowsToRenew = selectedRows()
  if (!rowsToRenew.length) return
  renewing.value = true
  try {
    for (const row of rowsToRenew) {
      await client.mutation(api.mail.push.renew, {
        user: row.user,
        id: row.id,
      })
    }
    raiseToast(__('Selected subscriptions renewed.'))
    listViewRef.value?.toggleAllRows()
  } catch (error) {
    const err = error as {
      messages?: string[]
      message?: string
    }
    raiseError(err)
  } finally {
    // Reload after any outcome: a mid-loop failure still leaves earlier subscriptions renewed with
    // updated expiry, so the table must reflect current server state without a manual refresh.
    renewing.value = false
    pushSubscriptions.refetch().catch(() => {})
  }
}
const deletePushSubscriptions = useMutation(api.mail.push.delete)
async function deletePushSubscriptionsSubmit() {
  const input: InputOf<typeof api.mail.push.delete> = {
    names: selectedNames(),
  }
  await deletePushSubscriptions.run(input)
  raiseToast(__('Selected subscriptions deleted.'))
  showDeleteModal.value = false
  listViewRef.value?.toggleAllRows()
  pushSubscriptions.refetch().catch(() => {})
}
const deleteModalOptions = computed(() => ({
  title: __('Delete Push Subscriptions'),
  message: __('Are you sure you want to delete the selected push subscriptions?'),
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      theme: 'red' as const,
      onClick: () => deletePushSubscriptionsSubmit(),
      loading: deletePushSubscriptions.isPending,
    },
  ],
}))

// `fr` units (numbers) so the columns share the row width instead of overflowing.
const COLUMNS = [
  {
    label: __('Device Client ID'),
    key: 'device_client_id',
    width: 2,
  },
  {
    label: __('Subscription ID'),
    key: 'id',
    width: 2,
  },
  {
    label: __('Types'),
    key: 'types',
    width: 2,
  },
  {
    label: __('Expires'),
    key: 'expires',
    width: 2,
  },
]
const MESSAGE = __(
  'Push subscriptions let your devices receive real-time notifications when your mail changes. Create one to register this or another client.',
)
</script>
