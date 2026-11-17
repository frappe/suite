<!--
  Mail > Screener: whether mail from new senders waits for a decision, what blocking a sender does
  to their mail already here, and the senders and domains already accepted or blocked. The switch
  and the select save on change.
-->
<template>
  <SettingsPage
    :description="__('Decide who can reach your Inbox')"
    :loading="!preferences"
    :reads="[preferencesRead, store.userResource]"
  >
    <template v-if="preferences">
      <SettingsSection>
        <SettingsRow
          :title="__('Screen new senders')"
          :description="
            __('Mail from someone new waits in the Screener until you accept or block them')
          "
        >
          <Switch
            :model-value="flag('enable_screening')"
            @update:model-value="(on: boolean) => setFlag('enable_screening', on)"
          />
        </SettingsRow>
        <!-- Future mail from a blocked sender always goes to Junk; this is only about what is
             already here. -->
        <SettingsRow
          :title="__('When blocking a sender')"
          :description="__('What happens to their mail that is already in your Inbox')"
        >
          <Select
            :model-value="preferences.on_block_old_mail"
            :options="ON_BLOCK_OLD_MAIL_OPTIONS"
            @update:model-value="setOnBlockOldMail"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        :title="__('Screened senders')"
        :description="
          __('Mail from an accepted sender reaches your Inbox; a blocked one goes to Junk')
        "
      >
        <template #actions>
          <Button icon-left="lucide-plus" :label="__('New')" @click="showAddModal = true" />
        </template>
        <SettingsLoading v-if="!screenedAddresses.data" />
        <SettingsEmpty
          v-else-if="!screenedAddresses.data.length"
          :title="__('No screened senders yet')"
          :description="
            __('Accept or block a sender, or a whole domain such as @example.com, to list it here.')
          "
        />
        <template v-else>
          <div class="flex gap-2 py-2">
            <TextInput
              v-model="search"
              class="min-w-0 flex-1"
              type="search"
              :placeholder="__('Search senders')"
              :aria-label="__('Search screened senders')"
            >
              <template #prefix>
                <span class="lucide-search size-4 text-ink-gray-5" aria-hidden="true" />
              </template>
            </TextInput>
            <Select
              v-model="sort"
              class="w-36 shrink-0"
              :options="SORT_OPTIONS"
              :aria-label="__('Sort by')"
            />
            <Button
              :icon="direction === 'asc' ? 'lucide-arrow-up' : 'lucide-arrow-down'"
              :tooltip="direction === 'asc' ? __('Ascending') : __('Descending')"
              :aria-label="direction === 'asc' ? __('Ascending') : __('Descending')"
              @click="direction = direction === 'asc' ? 'desc' : 'asc'"
            />
          </div>
          <SettingsSelectionBar v-if="rows.length" :selection="selection">
            <template #actions>
              <Button
                :label="__('Accept')"
                :loading="setAction.isPending"
                @click="void changeSelected('Accepted').catch(() => {})"
              />
              <Button
                :label="__('Block')"
                :loading="setAction.isPending"
                @click="void changeSelected('Spam').catch(() => {})"
              />
              <Button
                theme="red"
                :label="__('Remove')"
                :loading="remove.isPending"
                @click="void removeSelected().catch(() => {})"
              />
            </template>
          </SettingsSelectionBar>
          <SettingsListRow
            v-for="address in rows"
            :key="address.email"
            v-bind="selection.row(address.email)"
            :title="address.email"
            :subtitle="address.subtitle"
            :menu="addressMenu(address)"
          >
            <template #trailing>
              <Badge
                :label="ACTION_LABELS[address.action]"
                :theme="address.action === 'Spam' ? 'red' : 'green'"
                variant="subtle"
              />
            </template>
          </SettingsListRow>
          <p v-if="!rows.length" class="py-3.5 text-p-base text-ink-gray-6">
            {{ __('No screened senders match your search.') }}
          </p>
        </template>
      </SettingsSection>
    </template>

    <AddScreenedSenderModal v-model="showAddModal" />
  </SettingsPage>
</template>

<script setup lang="ts">
import { Badge, Button, Select, SettingsRow, Switch, TextInput } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation } from '@/api'
import AddScreenedSenderModal from '@/apps/mail/components/Modals/AddScreenedSenderModal.vue'
import { useAccountPreferences } from '@/apps/mail/composables/useAccountPreferences'
import { userStore } from '@/apps/mail/stores/user'
import type { ScreenedAddress, ScreeningAction } from '@/apps/mail/types'
import { getFormattedDate } from '@/apps/mail/utils'
import { formatSystemDateTime } from '@/apps/mail/utils/datetime'
import { confirm, toast } from '@/platform/feedback'
import {
  SettingsEmpty,
  SettingsListRow,
  SettingsLoading,
  SettingsPage,
  SettingsSection,
  SettingsSelectionBar,
  useSettingsSelection,
} from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const store = userStore()
const { screenedAddresses } = store
const { preferences, read: preferencesRead, save, flag, setFlag } = useAccountPreferences()
const showAddModal = ref(false)

const ON_BLOCK_OLD_MAIL_OPTIONS = [
  { label: __('Ask each time'), value: 'Ask' },
  { label: __('Move old mail to Junk'), value: 'Move to Junk' },
  { label: __('Keep old mail'), value: 'Keep' },
]
function setOnBlockOldMail(value?: string | number | null) {
  if (value === 'Ask' || value === 'Move to Junk' || value === 'Keep')
    void save('on_block_old_mail', value)
}

// Blocking a sender files their mail into Junk (the Spam action); nothing is discarded unseen.
const ACTION_LABELS: Record<ScreeningAction, string> = {
  Accepted: __('Accepted'),
  Spam: __('Blocked'),
}

// Most recently changed first by default, as the server lists them. A new field starts in its
// natural order (dates newest first, addresses A to Z) and the arrow beside it reverses it; the raw
// values sort, not the labels shown.
type SortField = 'modified' | 'creation' | 'email'
const SORT_OPTIONS: { label: string; value: SortField }[] = [
  { label: __('Last changed'), value: 'modified' },
  { label: __('Date added'), value: 'creation' },
  { label: __('Email'), value: 'email' },
]
const sort = ref<SortField>('modified')
const direction = ref<'asc' | 'desc'>('desc')
watch(sort, (field) => (direction.value = field === 'email' ? 'asc' : 'desc'))
const search = ref('')
const rows = computed(() => {
  const query = search.value.trim().toLowerCase()
  const field = sort.value
  const order = direction.value === 'asc' ? 1 : -1
  return (screenedAddresses.data ?? [])
    .filter((address: ScreenedAddress) => !query || address.email.toLowerCase().includes(query))
    .sort((a, b) => a[field].localeCompare(b[field]) * order)
    .map((address: ScreenedAddress) => ({
      email: address.email,
      action: address.action,
      // When the sender was last accepted or blocked. `modified` is a naive system-zone DB
      // timestamp; move it into the user's zone before the Today/Yesterday labels apply. Blank (an
      // optimistic row) stays blank.
      subtitle: address.modified
        ? getFormattedDate(formatSystemDateTime(address.modified, 'YYYY-MM-DDTHH:mm:ss'))
        : undefined,
    }))
})

const setAction = useMutation(api.mail.screening.set)
async function changeAction(email: string, action: ScreeningAction) {
  await setAction.run({ account: store.accountId, emails: [email], action })
  toast.success(action === 'Spam' ? __('{0} blocked', [email]) : __('{0} accepted', [email]))
}

// Bulk changes go in one request each; the server rebuilds the screening rules once.
const selection = useSettingsSelection(() => rows.value.map((address) => address.email))

async function changeSelected(action: ScreeningAction) {
  const emails = selection.selected
  await setAction.run({ account: store.accountId, emails, action })
  selection.clear()
  const [only] = emails
  if (emails.length === 1 && only)
    toast.success(action === 'Spam' ? __('{0} blocked', [only]) : __('{0} accepted', [only]))
  else
    toast.success(
      action === 'Spam'
        ? __('{0} senders blocked', [emails.length])
        : __('{0} senders accepted', [emails.length]),
    )
}

const remove = useMutation(api.mail.screening.remove)
// The account is read before the confirm, so a removal goes to the account it was asked in.
async function removeSelected() {
  const account = store.accountId
  const emails = selection.selected
  const [only] = emails
  const confirmed = await confirm({
    title:
      emails.length === 1 && only
        ? __('Remove {0}?', [only])
        : __('Remove {0} senders?', [emails.length]),
    message: __('Their mail is no longer accepted or blocked for you.'),
    confirmLabel: __('Remove'),
    destructive: true,
  })
  if (!confirmed) return
  await remove.run({ account, emails })
  selection.clear()
  toast.success(
    emails.length === 1 && only
      ? __('{0} removed', [only])
      : __('{0} senders removed', [emails.length]),
  )
}

async function removeAddress(email: string) {
  const account = store.accountId
  const confirmed = await confirm({
    title: __('Remove {0}?', [email]),
    message: __('Their mail is no longer accepted or blocked for you.'),
    confirmLabel: __('Remove'),
    destructive: true,
  })
  if (!confirmed) return
  await remove.run({ account, emails: [email] })
  toast.success(__('{0} removed', [email]))
}

const addressMenu = (address: { email: string; action: ScreeningAction }) => [
  address.action === 'Spam'
    ? {
        label: __('Accept'),
        icon: 'lucide-user-check',
        onClick: () => void changeAction(address.email, 'Accepted').catch(() => {}),
      }
    : {
        label: __('Block'),
        icon: 'lucide-ban',
        onClick: () => void changeAction(address.email, 'Spam').catch(() => {}),
      },
  {
    label: __('Remove'),
    icon: 'lucide-trash-2',
    theme: 'red' as const,
    onClick: () => void removeAddress(address.email).catch(() => {}),
  },
]
</script>
