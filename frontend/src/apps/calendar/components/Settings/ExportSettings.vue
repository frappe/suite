<!--
  The Export side of Calendar > Import & export: the account's events as an
  archive, emailed when ready. "Only some events" narrows the export by
  calendar, title, date range and count.
-->
<template>
  <SettingsSection>
    <SettingsRow :title="__('Format')" :description="__('The kind of file the events go into')">
      <Select
        :model-value="calendarExport.format"
        :options="FORMATS"
        @update:model-value="selectFormat"
      />
    </SettingsRow>
    <SettingsRow :title="__('Archive type')" :description="__('How the files are packed')">
      <Select
        :model-value="calendarExport.archive_type"
        :options="ARCHIVE_TYPES"
        @update:model-value="selectArchiveType"
      />
    </SettingsRow>
    <SettingsRow
      :title="__('Only some events')"
      :description="__('Pick a calendar, a title or a date range')"
    >
      <Switch v-model="customSelection" />
    </SettingsRow>
    <div v-if="customSelection" class="grid gap-4 py-3.5 sm:grid-cols-2">
      <FormControl
        v-model="filter.inCalendar"
        :label="__('Calendar')"
        type="select"
        :options="calendarOptions"
      />
      <FormControl v-model="filter.title" type="text" :label="__('Title contains')" />
      <FormControl v-model="filter.after" type="date" :label="__('From')" />
      <FormControl v-model="filter.before" type="date" :label="__('To')" />
      <FormControl v-model="calendarExport.limit" :label="__('Most events')" type="number" />
      <FormControl
        v-if="calendarExport.limit && calendarExport.limit > 0"
        v-model="calendarExport.sort"
        :label="__('Start from')"
        type="select"
        :options="SORTS"
      />
    </div>
    <ExchangeStatus
      :status="status"
      :href="statusHref"
      :link-label="ongoing.data?.name ? __('Track status') : __('View history')"
    >
      <Button
        variant="solid"
        :label="__('Export')"
        :loading="Boolean(ongoing.data?.name) || createExport.isPending"
        :disabled="ongoing.isFetching || Boolean(ongoing.error) || createExport.isPending"
        @click="startExport"
      />
    </ExchangeStatus>
  </SettingsSection>
</template>

<script setup lang="ts">
import { Button, FormControl, Select, SettingsRow, Switch } from 'frappe-ui'
import { computed, onScopeDispose, reactive, ref } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useCalendarSocket } from '@/apps/calendar/socket'
import { userStore } from '@/apps/calendar/stores/user'
import { utcDayEnd, utcDayStart } from '@/apps/calendar/utils/datetime'
import { SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

import ExchangeStatus from './ExchangeStatus.vue'

type ExportInput = InputOf<typeof api.mail.calendar.export>

const FORMATS: { label: string; value: ExportInput['format'] }[] = [
  { label: __('JMAP'), value: 'jmap' },
  { label: __('iCalendar (.ics)'), value: 'ics' },
]
const ARCHIVE_TYPES: { label: string; value: ExportInput['archive_type'] }[] = [
  { label: '.zip', value: '.zip' },
  { label: '.tgz', value: '.tgz' },
  { label: '.tar.gz', value: '.tar.gz' },
]
const SORTS: { label: string; value: ExportInput['sort'] }[] = [
  { label: __('Oldest events'), value: 'Start (ASC)' },
  { label: __('Newest events'), value: 'Start (DESC)' },
]

const store = userStore()
const user = store.userResource
const socket = useCalendarSocket()

const calendarExport = reactive<Omit<ExportInput, 'account' | 'filter'>>({
  format: 'jmap',
  archive_type: '.zip',
  sort: 'Start (ASC)',
  limit: undefined,
})

function selectFormat(value?: string | number | null) {
  const format = FORMATS.find((option) => option.value === value)?.value
  if (format) calendarExport.format = format
}

function selectArchiveType(value?: string | number | null) {
  const type = ARCHIVE_TYPES.find((option) => option.value === value)?.value
  if (type) calendarExport.archive_type = type
}

const customSelection = ref(false)
const filter = reactive({ inCalendar: '', title: '', after: '', before: '' })
const calendarOptions = computed(() => [
  { label: __('All calendars'), value: '' },
  ...store.accountCalendarOptions(store.accountId).map(({ label, value }) => ({ label, value })),
])

const createExport = useMutation(api.mail.calendar.export)

function makeInput(): ExportInput {
  if (!customSelection.value)
    return { account: store.accountId, ...calendarExport, limit: undefined, filter: {} }
  const cleaned = Object.fromEntries(
    Object.entries(filter)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => Boolean(value)),
  )
  // The date pickers give local days; the API listens UTC, so send the day's bounds
  // in the user's zone or the first/last hours of the range get cut off.
  if (cleaned.after) cleaned.after = utcDayStart(cleaned.after)
  if (cleaned.before) cleaned.before = utcDayEnd(cleaned.before)
  return {
    account: store.accountId,
    ...calendarExport,
    limit: calendarExport.limit || undefined,
    filter: cleaned,
  }
}

async function startExport() {
  await createExport.run(makeInput())
}

const ongoing = useQuery(api.mail.calendar.ongoingExchange, () =>
  user.data && store.accountId
    ? {
        doctype: 'Calendar Exchange',
        fieldname: 'name',
        filters: {
          user: user.data.name,
          operation: 'Export',
          status: ['in', ['Queued', 'In Progress']],
        },
      }
    : false,
)
const onExchangeCompleted = (payload: { action: 'Import' | 'Export' }) => {
  if (payload.action === 'Export') ongoing.refetch().catch(() => {})
}
socket.on('calendar_exchange_completed', onExchangeCompleted)
onScopeDispose(() => socket.off('calendar_exchange_completed', onExchangeCompleted))

const status = computed(() =>
  ongoing.data?.name
    ? __("Export in progress. We'll email you when it's ready.")
    : __('No exports in progress.'),
)
const statusHref = computed(() =>
  ongoing.data?.name
    ? `/mail/calendar-exchanges/${ongoing.data.name}`
    : '/mail/calendar-exchanges?operation=Export',
)
</script>
