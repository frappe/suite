<template>
  <!-- Rows of the Inbox page's list. The screened senders are a long list, so they open in a dialog. -->
  <SettingsRow
    :title="__('Screen new senders')"
    :description="
      __(
        'Mail from new senders goes to the Screener instead of your Inbox. Only accepted senders reach your Inbox.',
      )
    "
  >
    <Switch
      :model-value="screeningEnabled"
      :disabled="setScreening.isPending"
      @update:model-value="toggleScreening"
    />
  </SettingsRow>
  <SettingsRow
    :title="__('When blocking a sender')"
    :description="__('What to do with their mail already in your Inbox.')"
  >
    <Select
      :model-value="activeAccount?.on_block_old_mail"
      :options="ON_BLOCK_OLD_MAIL_OPTIONS"
      :disabled="setScreening.isPending"
      @update:model-value="setOnBlockOldMail"
    />
  </SettingsRow>
  <SettingsDialogRow
    :title="__('Screened senders')"
    section="mail.inbox.screened-senders"
    :description="__('The senders and domains you accept or block.')"
    :action="__('Manage')"
    size="3xl"
  >
    <div class="flex flex-col gap-5">
      <template v-if="screenedAddresses.data?.length">
        <div class="flex shrink-0 gap-2">
          <FormControl
            v-model="search"
            type="text"
            variant="outline"
            :placeholder="__('Search screened senders')"
            class="flex-1"
          >
            <template #prefix>
              <FeatherIcon name="search" class="text-ink-gray-5 w-4" />
            </template>
          </FormControl>
          <!-- Segmented sort control: field picker + direction toggle share a seam
					(-ml-px collapses the doubled border). -->
          <div class="flex">
            <AdaptiveDropdown :options="sortOptions" :title="__('Sort by')">
              <Button
                variant="outline"
                :label="sortLabel"
                icon-right="lucide-chevron-down"
                class="!rounded-r-none"
              />
            </AdaptiveDropdown>
            <Button
              variant="outline"
              :icon="sortDir === 'asc' ? 'lucide-arrow-up' : 'lucide-arrow-down'"
              :tooltip="sortDir === 'asc' ? __('Ascending') : __('Descending')"
              class="-ml-px !rounded-l-none"
              @click="toggleSortDir"
            />
          </div>
          <Button icon-left="lucide-plus" :label="__('New')" @click="addSender" />
        </div>

        <!-- A long list scrolls in its own box, so the dialog keeps its size. -->
        <div v-if="rows.length" class="flex max-h-80 flex-col">
          <ListView ref="listView" class="!w-full" :columns="COLUMNS" :rows="rows" row-key="email">
            <ListHeader />
            <ListRows />
            <!-- Default-slot override: drops the banner's built-in "Select all"
						     (redundant next to the header's master checkbox) and, on mobile,
						     its min-w-[596px], which is wider than the screen. -->
            <ListSelectBanner class="max-sm:!min-w-0">
              <template #default="{ selections, unselectAll }">
                <span class="text-ink-gray-9 shrink-0">
                  {{ __('{0} selected', [String(selections.size)]) }}
                </span>
                <div class="ml-auto flex items-center gap-1">
                  <AdaptiveDropdown :options="bulkActionOptions" :title="__('Change action')">
                    <Button
                      variant="ghost"
                      :label="__('Change action')"
                      icon-right="lucide-chevron-down"
                    />
                  </AdaptiveDropdown>
                  <Button
                    variant="ghost"
                    theme="red"
                    :label="__('Remove')"
                    @click="showRemoveModal = true"
                  />
                  <Button icon="lucide-x" variant="ghost" @click="unselectAll" />
                </div>
              </template>
            </ListSelectBanner>
          </ListView>
        </div>
        <div v-else class="text-ink-gray-6 text-sm">
          <p>{{ __('No screened senders match your search.') }}</p>
        </div>
      </template>
      <div v-else class="text-ink-gray-6 flex flex-col space-y-2 text-sm">
        <p class="text-base font-medium">{{ __('No screened senders yet') }}</p>
        <p>{{ MESSAGE }}</p>
        <Button icon-left="lucide-plus" :label="__('New')" class="w-fit" @click="addSender" />
      </div>

      <AddScreenedSenderModal v-model="showAddModal" />
      <Dialog v-model:open="showRemoveModal" v-bind="removeModalOptions" />
    </div>
  </SettingsDialogRow>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl, Select, SettingsRow, Switch } from 'frappe-ui'
import {
  Icon as FeatherIcon,
  ListHeader,
  ListRows,
  ListSelectBanner,
  ListView,
} from 'frappe-ui/experimental'
import { computed, ref, useTemplateRef } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import AddScreenedSenderModal from '@/apps/mail/components/Modals/AddScreenedSenderModal.vue'
import { userStore } from '@/apps/mail/stores/user'
import type { ScreenedAddress, ScreeningAction } from '@/apps/mail/types'
import { getFormattedDate, raiseToast } from '@/apps/mail/utils'
import { formatSystemDateTime } from '@/apps/mail/utils/datetime'
import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'
import { translate as __ } from '@/platform/translation'

const store = userStore()
const { screenedAddresses } = store
const search = ref('')
const listViewRef = useTemplateRef('listView')
const showAddModal = ref(false)
function addSender() {
  showAddModal.value = true
}

const showRemoveModal = ref(false)

// Read the flag from the shared user data (not a document draft) so the inbox reacts to a toggle
// here without a reload. Turning screening off asks nothing more: mail still waiting is in the Inbox
// already, and only shows as from a new sender while screening is on.
const activeAccount = computed(() =>
  store.userResource?.data?.accounts?.find((a) => a.id === store.accountId),
)
const setScreening = useMutation(api.mail.settings.updateAccount)
const screeningEnabled = computed(() => !!activeAccount.value?.enable_screening)
const toggleScreening = async (val: boolean) => {
  const account = activeAccount.value
  if (!account) return
  await setScreening.run({
    account: store.accountId,
    changes: {
      enable_screening: val ? 1 : 0,
    },
  })
  raiseToast(val ? __('Screener turned on') : __('Screener turned off'))
}

// Future mail from a blocked sender always goes to Junk; this is only about what is already there
const ON_BLOCK_OLD_MAIL_OPTIONS = [
  { label: __('Ask each time'), value: 'Ask' as const },
  { label: __('Move old mail to Junk'), value: 'Move to Junk' as const },
  { label: __('Keep old mail'), value: 'Keep' as const },
]
async function setOnBlockOldMail(value: unknown) {
  const choice = ON_BLOCK_OLD_MAIL_OPTIONS.find((option) => option.value === value)
  if (!choice) return

  await setScreening.run({
    account: store.accountId,
    changes: { on_block_old_mail: choice.value },
  })
}

// Blocking a sender files their mail into Junk (the Spam action); nothing is discarded unseen.
const ACTION_LABELS: Partial<Record<ScreeningAction, string>> = {
  Accepted: __('Accept'),
  Spam: __('Block'),
}

// Sort by when a rule was added ('creation'), last changed ('modified'), or alphabetically ('email').
// Defaults to most-recently modified, matching the backend's default order.
type SortField = 'modified' | 'creation' | 'email'
const SORT_LABELS: Record<SortField, string> = {
  modified: __('Last modified'),
  creation: __('Created'),
  email: __('Email'),
}
const sortField = ref<SortField>('modified')
const sortDir = ref<'asc' | 'desc'>('desc')
const sortLabel = computed(() => SORT_LABELS[sortField.value])
const sortOptions = computed(() =>
  (['modified', 'creation', 'email'] satisfies SortField[]).map((field) => ({
    label: SORT_LABELS[field],
    onClick: () => (sortField.value = field),
  })),
)
const toggleSortDir = () => (sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc')

// Filter by the search term, then sort by the chosen field/direction, before mapping to display rows.
// Sorting on the raw values (not the translated action label or formatted date) keeps the order correct.
const rows = computed(() => {
  const query = search.value.trim().toLowerCase()
  const dir = sortDir.value === 'asc' ? 1 : -1
  return (screenedAddresses.data ?? [])
    .filter((a: ScreenedAddress) => !query || a.email.toLowerCase().includes(query))
    .slice()
    .sort((a: ScreenedAddress, b: ScreenedAddress) => {
      const field = sortField.value
      // ISO timestamps sort correctly as plain strings, so one localeCompare covers all fields.
      return a[field].localeCompare(b[field]) * dir
    })
    .map((a: ScreenedAddress) => ({
      email: a.email,
      action: ACTION_LABELS[a.action] ?? a.action,
      // `modified` is a naive system-zone DB timestamp; move it into the user's zone
      // before the Today/Yesterday labels are applied. Blank (optimistic rows) stays blank.
      modified: a.modified
        ? getFormattedDate(formatSystemDateTime(a.modified, 'YYYY-MM-DDTHH:mm:ss'))
        : '',
    }))
})
const selectedEmails = () =>
  Array.from(listViewRef.value?.selections ?? []).filter(
    (value): value is string => typeof value === 'string',
  )

// Bulk edit: `screen_email_addresses` upserts the action for every selected address and rebuilds the
// sieve script only once, so switching many senders between Block/Junk/Accept is a single request.
const editScreenedAddresses = useMutation(api.mail.screening.set)
async function editScreenedAddressesSubmit({ action }: { action: ScreeningAction }) {
  const input: InputOf<typeof api.mail.screening.set> = {
    account: store.accountId,
    emails: selectedEmails(),
    action,
  }
  await editScreenedAddresses.run(input)
  raiseToast(__('Action updated'))
  listViewRef.value?.toggleAllRows()
}
const bulkActionOptions = (['Accepted', 'Spam'] satisfies ScreeningAction[]).map((action) => ({
  label: ACTION_LABELS[action] ?? action,
  onClick: () =>
    editScreenedAddressesSubmit({
      action,
    }),
}))

// Bulk delete: deletes the selected records and rebuilds the sieve script once (the backend deletes the
// rows in a single query and regenerates the script a single time afterwards).
const unscreenEmailAddresses = useMutation(api.mail.screening.remove)
async function unscreenEmailAddressesSubmit() {
  const input: InputOf<typeof api.mail.screening.remove> = {
    account: store.accountId,
    emails: selectedEmails(),
  }
  await unscreenEmailAddresses.run(input)
  raiseToast(__('Senders removed'))
  showRemoveModal.value = false
  listViewRef.value?.toggleAllRows()
}
const removeModalOptions = computed(() => ({
  title: __('Remove the selected senders?'),
  message: __('They are taken off your screened list.'),
  actions: [
    {
      label: __('Remove senders'),
      variant: 'solid' as const,
      onClick: () => unscreenEmailAddressesSubmit(),
      loading: unscreenEmailAddresses.isPending,
    },
  ],
}))

// Shares of the panel's width, each free to shrink below its contents (`minmax(0, …)`), in a list
// held to the panel's width (`!w-full` over the list's own `w-max`): sized to its longest address
// instead, the table ran past the panel and clipped Last Modified.
const COLUMNS = [
  {
    label: __('Email or domain'),
    key: 'email',
    width: 'minmax(0, 3fr)',
  },
  {
    label: __('Action'),
    key: 'action',
    width: 'minmax(0, 1fr)',
  },
  {
    label: __('Last modified'),
    key: 'modified',
    width: 'minmax(0, 1fr)',
  },
]
const MESSAGE = __(
  'Screen specific senders — or a whole domain (e.g. @example.com) — to either reject their messages or send them straight to Junk.',
)
</script>
