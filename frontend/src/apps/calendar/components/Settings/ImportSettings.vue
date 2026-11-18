<template>
  <div class="flex flex-col gap-5">
    <FormControl
      v-model="calendarImport.format"
      :label="__('Format')"
      type="select"
      variant="outline"
      :options="FORMAT_OPTIONS"
      required
    />
    <FormControl
      v-model="calendarImport.calendar"
      :label="__('Calendar')"
      type="select"
      variant="outline"
      :options="importOptions"
    />
    <SettingsFileField
      :label="__('File')"
      :description="fileUploadSubtitle"
      :accept="acceptTypes"
      :upload="uploadFile"
      :progress
    />
    <Alert
      v-if="isImportRunning"
      :title="__('Import in progress. We’ll email you when it’s ready.')"
    />
    <ErrorMessage :message="importError" />
    <SettingsDialogActions>
      <Button :label="importLinkText" :href="importHref" />
      <Button
        :label="__('Start import')"
        variant="solid"
        :loading="isImporting"
        :disabled="isImportBlocked"
        @click="createCalendarImport.run(makeInput())"
      />
    </SettingsDialogActions>
  </div>
</template>

<script setup lang="ts">
import { Alert, Button, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, onScopeDispose, reactive, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useCalendarSocket } from '@/apps/calendar/socket'
import { userStore } from '@/apps/calendar/stores/user'
import { destinationOptions } from '@/apps/calendar/utils/calendars'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import SettingsFileField from '@/platform/settings/SettingsFileField.vue'
import { translate as __ } from '@/platform/translation'
import { useChunkedUpload } from '@/utils/useChunkedUpload'

const store = userStore()
const { accountId } = store
const user = store.userResource
const socket = useCalendarSocket()
const calendarImport = reactive<Omit<InputOf<typeof api.mail.calendar.import>, 'account'>>({
  format: 'ics',
  file: '',
  calendar: '',
})
const { progress, upload } = useChunkedUpload()
const acceptTypes = computed(() => (calendarImport.format === 'ics' ? '.ics' : '.zip,.tgz,.tar.gz'))

// Upload in chunks so large import archives aren't blocked by the web server's request-size limit.
async function uploadFile(file: File) {
  const uploaded = await upload(file, { private: true })
  calendarImport.file = uploaded.file_url
}

// Only a calendar the account can write to takes the events.
const importOptions = computed(() => destinationOptions(store.accountCalendarOptions(accountId)))

// Kept while it is still one of the account's calendars; otherwise the first — a calendar
// that was deleted, or belongs to the account switched away from, is no target at all.
watch(
  importOptions,
  (options) => {
    if (!options.some((option) => option.value === calendarImport.calendar))
      calendarImport.calendar = options[0]?.value ?? ''
  },
  {
    immediate: true,
  },
)
const fileUploadSubtitle = computed(() => {
  if (calendarImport.format === 'ics') return __('Supported file format: .ics')
  return __('Supported file formats: .zip, .tar, .tgz')
})
const createCalendarImport = useMutation(api.mail.calendar.import)
const makeInput = () => ({
  account: store.accountId,
  ...calendarImport,
})
const ongoingImport = useQuery(api.mail.calendar.ongoingExchange, () =>
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
const isImportRunning = computed(() => Boolean(ongoingImport.data?.name))
const isImporting = computed(() => isImportRunning.value || createCalendarImport.isPending)
const importError = computed(() => createCalendarImport.error?.message)
const isImportBlocked = computed(
  () => ongoingImport.isFetching || Boolean(ongoingImport.error) || !calendarImport.file,
)
const onExchangeCompleted = (payload: { action: 'Import' | 'Export' }) => {
  if (payload.action === 'Import') ongoingImport.refetch().catch(() => {})
}
socket.on('calendar_exchange_completed', onExchangeCompleted)
onScopeDispose(() => socket.off('calendar_exchange_completed', onExchangeCompleted))
const importHref = computed(() => {
  if (ongoingImport.data?.name) return `/mail/calendar-exchanges/${ongoingImport.data.name}`
  return '/mail/calendar-exchanges?operation=Import'
})
const importLinkText = computed(() => {
  if (ongoingImport.data?.name) return __('Track status')
  return __('View history')
})
const FORMAT_OPTIONS = ['ics', 'jmap']
</script>
