<!--
  Mail > Advanced > Push subscriptions: the apps and sites the mail server tells at once when new
  mail arrives, so they can update or notify without checking. Each one expires and can be renewed.
-->
<template>
  <SettingsSection
    :title="__('Push subscriptions')"
    :description="
      __(
        'Apps and sites the mail server tells right away when your mail changes, so they can notify you',
      )
    "
  >
    <template #actions>
      <Button icon-left="lucide-plus" :label="__('New')" @click="showAddModal = true" />
    </template>
    <SettingsLoading v-if="!subscriptions.data" />
    <template v-else-if="subscriptions.data.length">
      <SettingsSelectionBar :selection="selection">
        <template #actions>
          <Button
            :label="__('Renew')"
            :loading="renewingSelected"
            @click="void renewSelected().catch(() => {})"
          />
          <Button
            theme="red"
            :label="__('Delete')"
            :loading="remove.isPending"
            @click="void deleteSelected().catch(() => {})"
          />
        </template>
      </SettingsSelectionBar>
      <SettingsListRow
        v-for="subscription in subscriptions.data"
        :key="subscription.name"
        v-bind="selection.row(subscription.name)"
        :title="clientOf(subscription)"
        :subtitle="detailsOf(subscription)"
        :menu="subscriptionMenu(subscription)"
      />
    </template>
    <SettingsEmpty
      v-else
      :title="__('No push subscriptions')"
      :description="__('Add one to let an app know when your mail changes.')"
    />

    <AddPushSubscriptionModal v-model="showAddModal" @created="refetch" />
  </SettingsSection>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { ref } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import AddPushSubscriptionModal from '@/apps/mail/components/Modals/AddPushSubscriptionModal.vue'
import { userStore } from '@/apps/mail/stores/user'
import type { PushSubscription } from '@/apps/mail/types'
import dayjs from '@/apps/mail/utils/dayjs'
import { confirm, toast } from '@/platform/feedback'
import {
  SettingsEmpty,
  SettingsListRow,
  SettingsLoading,
  SettingsSection,
  SettingsSelectionBar,
  useSettingsSelection,
} from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const user = userStore().userResource
const showAddModal = ref(false)

// Per user, not per account. A person has a handful of devices, so one page holds them all.
const subscriptions = useQuery(api.mail.push.list, () =>
  user.data ? { user: user.data.name, limit: 100 } : false,
)
const refetch = () => void subscriptions.refetch().catch(() => {})

// Named rather than shown by the server's bare id: this site's own says so, and any other (an app
// or site that registered one) is told apart by the start of its id.
const clientOf = (subscription: PushSubscription) =>
  subscription.this_site
    ? __('This site ({0})', [window.location.host])
    : __('Another app ({0})', [subscription.id.slice(0, 8)])

// `types` arrives as a JSON array string.
function typesOf(types: string) {
  try {
    const parsed: unknown = JSON.parse(types)
    return Array.isArray(parsed) ? parsed.join(', ') : ''
  } catch {
    return ''
  }
}
function detailsOf(subscription: PushSubscription) {
  const parts = [typesOf(subscription.types)]
  if (subscription.expires)
    parts.push(__('Expires {0}', [dayjs(subscription.expires).format('D MMM YYYY')]))
  return parts.filter(Boolean).join(' · ') || undefined
}

const renew = useMutation(api.mail.push.renew)
async function renewSubscription(subscription: PushSubscription) {
  await renew.run({ user: subscription.user, id: subscription.id })
  toast.success(__('Push subscription renewed'))
  refetch()
}

const remove = useMutation(api.mail.push.delete)
async function deleteSubscription(subscription: PushSubscription) {
  const confirmed = await confirm({
    title: __('Delete {0}?', [clientOf(subscription)]),
    message: __('It stops hearing about new mail until it subscribes again.'),
    confirmLabel: __('Delete'),
    destructive: true,
  })
  if (!confirmed) return
  await remove.run({ names: [subscription.name] })
  toast.success(__('Push subscription deleted'))
  refetch()
}

const selection = useSettingsSelection(() =>
  (subscriptions.data ?? []).map((subscription) => subscription.name),
)
const selectedSubscriptions = () => {
  const names = new Set(selection.selected)
  return (subscriptions.data ?? []).filter((subscription) => names.has(subscription.name))
}

// Renew has no batch endpoint, so each selected subscription renews in turn. The list reloads
// whatever happens: after a failure part way, the ones before it are renewed.
const renewingSelected = ref(false)
async function renewSelected() {
  const chosen = selectedSubscriptions()
  renewingSelected.value = true
  try {
    for (const subscription of chosen)
      await renew.run({ user: subscription.user, id: subscription.id })
    selection.clear()
    toast.success(
      chosen.length === 1
        ? __('Push subscription renewed')
        : __('{0} push subscriptions renewed', [chosen.length]),
    )
  } finally {
    renewingSelected.value = false
    refetch()
  }
}

async function deleteSelected() {
  const chosen = selectedSubscriptions()
  const [only] = chosen
  // One subscription asks by its name, as its own menu does. A deleted row leaves the selection.
  if (chosen.length === 1 && only) return deleteSubscription(only)
  const confirmed = await confirm({
    title: __('Delete {0} push subscriptions?', [chosen.length]),
    message: __('They stop hearing about new mail until they subscribe again.'),
    confirmLabel: __('Delete'),
    destructive: true,
  })
  if (!confirmed) return
  await remove.run({ names: chosen.map((subscription) => subscription.name) })
  selection.clear()
  toast.success(__('{0} push subscriptions deleted', [chosen.length]))
  refetch()
}

const subscriptionMenu = (subscription: PushSubscription) => [
  {
    label: __('Renew'),
    icon: 'lucide-refresh-cw',
    onClick: () => void renewSubscription(subscription).catch(() => {}),
  },
  {
    label: __('Delete'),
    icon: 'lucide-trash-2',
    theme: 'red' as const,
    onClick: () => void deleteSubscription(subscription).catch(() => {}),
  },
]
</script>
