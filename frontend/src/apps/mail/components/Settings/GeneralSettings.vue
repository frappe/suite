<!--
  Mail > General: how mail is read, how the Inbox is split, how mail is sent, the storage used,
  and (on a provider site) the locale and time zone. Every control saves on change.
-->
<template>
  <SettingsPage
    :description="__('How you read and send mail, and how much storage it uses')"
    :loading="!preferences"
    :reads="[preferencesRead, store.userResource]"
  >
    <template v-if="preferences">
      <SettingsSection :title="__('Reading')">
        <!-- A phone always shows one pane at a time, and its list has its own grouping. -->
        <template v-if="user.data?.is_jmap_configured && !isMobile">
          <SettingsRow
            :title="__('Split view')"
            :description="__('Show the open message beside the message list')"
          >
            <Switch :model-value="showReadingPane" @update:model-value="setReadingPane" />
          </SettingsRow>
          <SettingsRow
            :title="__('Group by date')"
            :description="__('Put headings in the message list: today, yesterday, this week')"
          >
            <Switch
              :model-value="groupedByDate"
              @update:model-value="(on: boolean) => void setGroupByDate(on).catch(() => {})"
            />
          </SettingsRow>
        </template>
        <SettingsRow
          :title="__('Block remote images')"
          :description="__('Do not load images from the web until you choose to show them')"
        >
          <Switch
            :model-value="flag('block_remote_images')"
            @update:model-value="(on: boolean) => setFlag('block_remote_images', on)"
          />
        </SettingsRow>
      </SettingsSection>

      <!-- Off, the Inbox is one list, and the chosen categories are kept for when it is on again. -->
      <SettingsSection v-if="tabsOffered" :title="__('Inbox')">
        <SettingsRow
          :title="__('Split Inbox into categories')"
          :description="__('Mail that is not personal moves out of Primary into its own tab')"
        >
          <Switch
            :model-value="split"
            @update:model-value="(on: boolean) => void setSplit(on).catch(() => {})"
          />
        </SettingsRow>
        <template v-if="split">
          <SettingsRow
            v-for="choice in categoryChoices"
            :key="choice.category"
            :title="choice.label"
            :description="CATEGORY_DESCRIPTIONS[choice.category]"
          >
            <!-- The last one on stays on: turning the split off is the way to one list. -->
            <Switch
              :model-value="choice.on"
              :disabled="choice.on && categoriesOn === 1"
              @update:model-value="
                (on: boolean) => void setTab(choice.category, on).catch(() => {})
              "
            />
          </SettingsRow>
        </template>
      </SettingsSection>

      <SettingsSection :title="__('Sending')">
        <SettingsRow
          :title="__('Default outgoing email')"
          :description="__('The address new mail is sent from')"
        >
          <Combobox
            trigger="button"
            align="end"
            :model-value="preferences.default_outgoing_email ?? ''"
            :options="identityEmails"
            :placeholder="__('Choose an address')"
            @update:model-value="setDefaultOutgoingEmail"
          />
        </SettingsRow>
        <SettingsRow
          :title="__('Undo send')"
          :description="__('How long mail waits before it goes, so you can still take it back')"
        >
          <Select
            :model-value="undoSendPeriod"
            :options="UNDO_SEND_OPTIONS"
            @update:model-value="setUndoSendPeriod"
          />
        </SettingsRow>
        <SettingsRow
          :title="__('Add recipients to contacts')"
          :description="__('Save each new address you send mail to as a contact')"
        >
          <Switch
            :model-value="flag('create_contacts_after_email_submit')"
            @update:model-value="(on: boolean) => setFlag('create_contacts_after_email_submit', on)"
          />
        </SettingsRow>
        <SettingsRow
          :title="__('Keep forwarded mail in its conversation')"
          :description="__('A message you forward shows in the conversation it came from')"
        >
          <Switch
            :model-value="flag('keep_forwarded_email_in_thread')"
            @update:model-value="(on: boolean) => setFlag('keep_forwarded_email_in_thread', on)"
          />
        </SettingsRow>
        <!-- Last of the switches: each one gives up the copy of what you send, and a copy that was
             never kept cannot be found or answered from later. -->
        <SettingsRow
          :title="__('Delete mail after sending')"
          :description="
            __(
              'Mail you send is not kept in Sent, so you cannot find, forward or reply to it later',
            )
          "
        >
          <Switch
            :model-value="flag('destroy_email_after_submit')"
            @update:model-value="(on: boolean) => setFlag('destroy_email_after_submit', on)"
          />
        </SettingsRow>
        <SettingsRow
          :title="__('Delete newsletters after sending')"
          :description="
            __('Bulk mail that your apps send through this account is not kept in Sent')
          "
        >
          <Switch
            :model-value="flag('destroy_newsletter_after_submit')"
            @update:model-value="(on: boolean) => setFlag('destroy_newsletter_after_submit', on)"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection :title="__('Storage')">
        <SettingsLoading v-if="!quota.data" />
        <div v-else class="flex flex-col gap-2 py-3.5">
          <p class="text-base text-ink-gray-8">{{ label }}</p>
          <div
            v-if="isLimited"
            class="h-1.5 w-full rounded-full bg-surface-gray-3"
            role="progressbar"
            :aria-valuenow="Math.round(usedPercentage)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="__('Storage used')"
          >
            <div
              class="h-full rounded-full"
              :class="isCritical ? 'bg-surface-red-7' : 'bg-surface-gray-7'"
              :style="{ width: `${Math.min(usedPercentage, 100)}%` }"
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection v-if="hasProvider" :title="__('Regional')">
        <SettingsLoading v-if="!regional.data && !regional.error" />
        <ErrorMessage v-else-if="regional.error" class="py-3.5" :message="regional.error.message" />
        <template v-else-if="regionalShown">
          <SettingsRow
            :title="__('Locale')"
            :description="__('How dates and numbers are written in your mail')"
          >
            <Combobox
              trigger="button"
              align="end"
              :model-value="regionalShown.locale"
              :options="regional.data?.locales ?? []"
              @update:model-value="(value) => saveRegional('locale', value)"
            />
          </SettingsRow>
          <SettingsRow
            :title="__('Time zone')"
            :description="__('The time zone of your mail account')"
          >
            <Combobox
              trigger="button"
              align="end"
              :model-value="regionalShown.time_zone"
              :options="regional.data?.time_zones ?? []"
              @update:model-value="(value) => saveRegional('time_zone', value)"
            />
          </SettingsRow>
        </template>
      </SettingsSection>
    </template>
  </SettingsPage>
</template>

<script setup lang="ts">
import { Combobox, ErrorMessage, Select, SettingsRow, Switch } from 'frappe-ui'
import { computed } from 'vue'

import { api, client, useQuery } from '@/api'
import { useAccountPreferences } from '@/apps/mail/composables/useAccountPreferences'
import { useTabChoice, type InboxCategory } from '@/apps/mail/composables/useInboxTabs'
import { useQuota } from '@/apps/mail/composables/useQuota'
import { userStore } from '@/apps/mail/stores/user'
import {
  useGroupByDate,
  useReadingPane,
  useScreenSize,
  useToggleReadingPane,
} from '@/apps/mail/utils/composables'
import { UNDO_SEND_PERIODS, undoSendPeriodOf } from '@/apps/mail/utils/undoSend'
import {
  SettingsLoading,
  SettingsPage,
  SettingsSection,
  useSavedFields,
} from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const store = userStore()
const user = store.userResource
const { isMobile } = useScreenSize()
const { preferences, read: preferencesRead, save, flag, setFlag } = useAccountPreferences()

// Reading

const showReadingPane = useReadingPane()
const toggleReadingPane = useToggleReadingPane()
function setReadingPane(on: boolean) {
  if (on !== showReadingPane.value) void toggleReadingPane()?.catch(() => {})
}
const { groupedByDate, setGroupByDate } = useGroupByDate()

// Inbox

const { offered: tabsOffered, split, choices: categoryChoices, setSplit, setTab } = useTabChoice()
const categoriesOn = computed(() => categoryChoices.value.filter((choice) => choice.on).length)
const CATEGORY_DESCRIPTIONS: Record<InboxCategory, string> = {
  primary: '',
  updates: __('Receipts, alerts, confirmations and other mail sent by systems'),
  forums: __('Mailing lists and discussion groups'),
  promotions: __('Newsletters, offers and marketing'),
  social: __('Mail from social networks'),
}

// Sending

const identityEmails = computed(() => (store.identities.data ?? []).map((i) => i.email))
function setDefaultOutgoingEmail(value?: string | number | null) {
  if (typeof value === 'string' && value) void save('default_outgoing_email', value)
}

// The select speaks the Select field's strings. The saved value goes through the same fallback
// the composer uses, so an unset value reads as the default.
const undoSendPeriod = computed(() => String(undoSendPeriodOf(user.data)))
const UNDO_SEND_OPTIONS = UNDO_SEND_PERIODS.map((seconds) => ({
  label: __('{0} seconds', [String(seconds)]),
  value: String(seconds),
}))
function setUndoSendPeriod(value?: string | number | null) {
  const period = String(value)
  if (period !== '5' && period !== '10' && period !== '20' && period !== '30') return
  // The user info updates at once and rolls back if the save fails.
  void client
    .mutation(api.mail.settings.updatePreferences, { undo_send_period: period })
    .catch(() => {})
}

// Storage

const { quota, isLimited, isCritical, usedPercentage, label } = useQuota()

// Regional, on a provider site only

const hasProvider = computed(() => !!user.data?.is_suite_cloud_configured)
const regional = useQuery(api.mail.settings.regional, () => (hasProvider.value ? {} : false))
// The server takes both fields at once; the one not being changed goes as the server has it.
const { shown: regionalShown, save: saveRegionalField } = useSavedFields(
  () =>
    regional.data ? { locale: regional.data.locale, time_zone: regional.data.time_zone } : null,
  (change) => (confirmed) =>
    client.mutation(api.mail.settings.updateRegional, { ...confirmed, ...change }),
)
function saveRegional(field: 'locale' | 'time_zone', value?: string | number | null) {
  if (typeof value === 'string' && value) void saveRegionalField(field, value)
}
</script>
