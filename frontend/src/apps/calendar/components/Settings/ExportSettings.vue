<template>
  <div class="flex flex-col gap-5">
    <FormControl
      v-model="calendarExport.format"
      :label="__('Format')"
      type="select"
      variant="outline"
      :options="FORMAT_OPTIONS"
    />
    <FormControl
      v-model="calendarExport.archive_type"
      :label="__('Archive type')"
      type="select"
      variant="outline"
      :options="ARCHIVE_TYPE_OPTIONS"
    />
    <SettingsRow
      class="!py-0"
      :title="__('Custom selection')"
      :description="__('Apply filters to select specific events for export.')"
    >
      <Switch v-model="customSelection" />
    </SettingsRow>
    <template v-if="customSelection">
      <FormControl
        v-model="filter.inCalendar"
        :label="__('Calendar')"
        type="select"
        variant="outline"
        :options="calendarOptions"
      />
      <FormControl v-model="filter.title" type="text" variant="outline" :label="__('Title')" />
      <FormControl v-model="filter.after" type="date" variant="outline" :label="__('From date')" />
      <FormControl v-model="filter.before" type="date" variant="outline" :label="__('To date')" />
      <FormControl
        v-model="calendarExport.limit"
        :label="__('Max number of events')"
        type="number"
        variant="outline"
        placeholder="1000"
      />
      <FormControl
        v-if="hasLimit"
        v-model="calendarExport.sort"
        :label="__('Start from')"
        type="select"
        variant="outline"
        :options="sortOptions"
      />
    </template>

    <Button
      class="min-h-7 self-start"
      :label="__('Start export')"
      :loading="isExporting"
      :disabled="isExportBlocked"
      @click="createCalendarExport.run(makeInput())"
    />
    <div class="!mt-3 space-x-1 text-base">
      <span class="text-ink-gray-5">{{ exportSubtitle }}</span>
      <a class="hover:underline" :href="exportHref" target="_blank">
        {{ exportLinkText }}
      </a>
    </div>
    <ErrorMessage
      v-if="createCalendarExport.error"
      :message="createCalendarExport.error?.message"
      class="mb-2.5"
    />
  </div>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormControl, SettingsRow, Switch } from 'frappe-ui'
import { computed, onScopeDispose, reactive, ref } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useCalendarSocket } from '@/apps/calendar/socket'
import { userStore } from '@/apps/calendar/stores/user'
import { utcDayEnd, utcDayStart } from '@/apps/calendar/utils/datetime'

const store = userStore()
const { accountId } = store
const user = store.userResource
const socket = useCalendarSocket()
const calendarExport = reactive<Omit<InputOf<typeof api.mail.calendar.export>, 'account'>>({
  format: 'jmap',
  archive_type: '.zip',
  sort: 'Start (ASC)',
  limit: undefined,
})
const customSelection = ref(false)
const filter = reactive({
  inCalendar: '',
  title: '',
  after: '',
  before: '',
})
const calendarOptions = computed(() => [
  {
    label: __(''),
    value: ' ',
  },
  ...store.accountCalendarOptions(accountId),
])
const sortOptions = computed(() => [
  {
    label: __('Oldest events'),
    value: 'Start (ASC)',
  },
  {
    label: __('Newest events'),
    value: 'Start (DESC)',
  },
])
const hasLimit = computed(() => !!calendarExport.limit && calendarExport.limit > 0)
const createCalendarExport = useMutation(api.mail.calendar.export)
function makeInput(): InputOf<typeof api.mail.calendar.export> {
  const cleanedFilter = Object.fromEntries(
    Object.entries(filter)
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
      .filter(([, v]) => Boolean(v)),
  )
  // The date pickers give local days; the API listens UTC, so send the day's bounds
  // in the user's zone or the first/last hours of the range get cut off.
  if (typeof cleanedFilter.after === 'string' && cleanedFilter.after)
    cleanedFilter.after = utcDayStart(cleanedFilter.after)
  if (typeof cleanedFilter.before === 'string' && cleanedFilter.before)
    cleanedFilter.before = utcDayEnd(cleanedFilter.before)
  return {
    account: store.accountId,
    ...calendarExport,
    limit: calendarExport.limit || undefined,
    filter: cleanedFilter,
  }
}
const ongoingExport = useQuery(api.mail.calendar.ongoingExchange, () =>
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
const isExporting = computed(
  () => Boolean(ongoingExport.data?.name) || createCalendarExport.isPending,
)
const isExportBlocked = computed(
  () => ongoingExport.isFetching || Boolean(ongoingExport.error) || createCalendarExport.isPending,
)
const onExchangeCompleted = (payload: { action: 'Import' | 'Export' }) => {
  if (payload.action === 'Export') ongoingExport.refetch().catch(() => {})
}
socket.on('calendar_exchange_completed', onExchangeCompleted)
onScopeDispose(() => socket.off('calendar_exchange_completed', onExchangeCompleted))
const exportSubtitle = computed(() => {
  if (ongoingExport.data?.name) return __('Export in progress. We’ll email you when it’s ready.')
  return __('No exports in progress.')
})
const exportHref = computed(() => {
  if (ongoingExport.data?.name) return `/mail/calendar-exchanges/${ongoingExport.data.name}`
  return '/mail/calendar-exchanges?operation=Export'
})
const exportLinkText = computed(() => {
  if (ongoingExport.data?.name) return __('Track status')
  return __('View history')
})
const FORMAT_OPTIONS = ['jmap', 'ics']
const ARCHIVE_TYPE_OPTIONS = ['.zip', '.tgz', '.tar.gz']
</script>
