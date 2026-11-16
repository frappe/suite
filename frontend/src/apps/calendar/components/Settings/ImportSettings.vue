<!--
  The Import side of Calendar > Import & export: a file of events goes into
  one of the account's calendars. The file uploads first; Import then queues
  the job, and the status line tracks it.
-->
<template>
  <SettingsSection>
    <SettingsRow :title="__('Format')" :description="__('The kind of file you are importing')">
      <Select
        :model-value="calendarImport.format"
        :options="FORMATS"
        @update:model-value="selectFormat"
      />
    </SettingsRow>
    <SettingsRow :title="__('Calendar')" :description="__('The calendar the events go into')">
      <Select
        :model-value="calendarImport.calendar"
        :options="calendarOptions"
        :placeholder="__('Select calendar')"
        @update:model-value="selectCalendar"
      />
    </SettingsRow>
    <SettingsRow :title="__('File')" :description="fileDescription">
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        :accept="acceptTypes"
        @change="onFileSelected"
      />
      <Button
        icon-left="lucide-upload"
        :label="uploading ? __('Uploading ({0}%)', [progress]) : __('Choose file')"
        :loading="uploading"
        @click="fileInput?.click()"
      />
    </SettingsRow>
    <ExchangeStatus
      :status="status"
      :href="statusHref"
      :link-label="ongoing.data?.name ? __('Track status') : __('View history')"
    >
      <Button
        variant="solid"
        :label="__('Import')"
        :loading="Boolean(ongoing.data?.name) || createImport.isPending"
        :disabled="ongoing.isFetching || Boolean(ongoing.error) || !calendarImport.file"
        @click="startImport"
      />
    </ExchangeStatus>
  </SettingsSection>
</template>

<script setup lang="ts">
import { Button, Select, SettingsRow } from 'frappe-ui'
import { computed, onScopeDispose, reactive, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useCalendarSocket } from '@/apps/calendar/socket'
import { userStore } from '@/apps/calendar/stores/user'
import { destinationOptions } from '@/apps/calendar/utils/calendars'
import { toast } from '@/platform/feedback'
import { SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'
import { useChunkedUpload } from '@/utils/useChunkedUpload'

import ExchangeStatus from './ExchangeStatus.vue'

type ImportInput = InputOf<typeof api.mail.calendar.import>

const FORMATS: { label: string; value: ImportInput['format'] }[] = [
  { label: __('iCalendar (.ics)'), value: 'ics' },
  { label: __('JMAP archive'), value: 'jmap' },
]

const store = userStore()
const user = store.userResource
const socket = useCalendarSocket()

const calendarImport = reactive<Omit<ImportInput, 'account'>>({
  format: 'ics',
  file: '',
  calendar: '',
})
const fileName = ref('')

function selectFormat(value?: string | number | null) {
  const format = FORMATS.find((option) => option.value === value)?.value
  if (format) calendarImport.format = format
}

// Only a calendar the account can write to takes the events.
const calendarOptions = computed(() =>
  destinationOptions(store.accountCalendarOptions(store.accountId)).map(({ label, value }) => ({
    label,
    value,
  })),
)

function selectCalendar(value?: string | number | null) {
  if (typeof value === 'string') calendarImport.calendar = value
}

// Kept while it is still one of the account's calendars; otherwise the first — a calendar
// that was deleted, or belongs to the account switched away from, is no target at all.
watch(
  calendarOptions,
  (options) => {
    if (!options.some((option) => option.value === calendarImport.calendar))
      calendarImport.calendar = options[0]?.value ?? ''
  },
  { immediate: true },
)

const fileInput = ref<HTMLInputElement | null>(null)
const { uploading, progress, upload } = useChunkedUpload()
const acceptTypes = computed(() => (calendarImport.format === 'ics' ? '.ics' : '.zip,.tgz,.tar.gz'))

const fileDescription = computed(() => {
  if (calendarImport.file) return __('Uploaded: {0}', [fileName.value])
  if (calendarImport.format === 'ics') return __('An .ics file')
  return __('A .zip, .tar or .tgz archive')
})

// Upload in chunks so large import archives aren't blocked by the web server's request-size limit.
async function onFileSelected(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  const input = event.target
  const file = input.files?.[0]
  input.value = '' // let the same file be re-selected after an error
  if (!file) return
  try {
    const uploaded = await upload(file, { private: true })
    calendarImport.file = uploaded.file_url
    fileName.value = file.name
  } catch {
    toast.error(__('Could not upload the file'))
  }
}

const createImport = useMutation(api.mail.calendar.import)

async function startImport() {
  await createImport.run({ account: store.accountId, ...calendarImport })
  calendarImport.file = ''
  fileName.value = ''
}

const ongoing = useQuery(api.mail.calendar.ongoingExchange, () =>
  user.data && store.accountId
    ? {
        doctype: 'Calendar Exchange',
        fieldname: 'name',
        filters: {
          user: user.data.name,
          account: store.accountId,
          operation: 'Import',
          status: ['in', ['Queued', 'In Progress']],
        },
      }
    : false,
)
const onExchangeCompleted = (payload: { action: 'Import' | 'Export' }) => {
  if (payload.action === 'Import') ongoing.refetch().catch(() => {})
}
socket.on('calendar_exchange_completed', onExchangeCompleted)
onScopeDispose(() => socket.off('calendar_exchange_completed', onExchangeCompleted))

const status = computed(() =>
  ongoing.data?.name
    ? __("Import in progress. We'll email you when it's done.")
    : __('No imports in progress.'),
)
const statusHref = computed(() =>
  ongoing.data?.name
    ? `/mail/calendar-exchanges/${ongoing.data.name}`
    : '/mail/calendar-exchanges?operation=Import',
)
</script>
