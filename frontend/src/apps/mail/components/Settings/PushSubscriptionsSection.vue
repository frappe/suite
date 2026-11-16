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
      <SettingsListRow
        v-for="subscription in subscriptions.data"
        :key="subscription.name"
        :title="clientOf(subscription)"
        :subtitle="detailsOf(subscription)"
        :menu="subscriptionMenu(subscription)"
      />
    </template>
    <SettingsEmpty
      v-else
      icon="lucide-bell-ring"
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
