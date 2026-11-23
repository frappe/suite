<template>
  <FormControl
    v-model="mailExport.format"
    :label="__('Format')"
    type="select"
    variant="outline"
    :options="FORMAT_OPTIONS"
  />
  <FormControl
    v-model="mailExport.archive_type"
    :label="__('Archive type')"
    type="select"
    variant="outline"
    :options="ARCHIVE_TYPE_OPTIONS"
  />
  <SettingsRow
    class="!py-0"
    :title="__('Custom selection')"
    :description="__('Apply filters to select specific messages for export.')"
  >
    <Switch v-model="customSelection" />
  </SettingsRow>
  <template v-if="customSelection">
    <FormControl
      v-model="filter.inMailbox"
      :label="__('Folder')"
      type="select"
      variant="outline"
      :options="mailboxOptions"
    />
    <FormControl v-model="filter.after" type="date" variant="outline" :label="__('From date')" />
    <FormControl v-model="filter.before" type="date" variant="outline" :label="__('To date')" />
    <FormControl
      v-model="filter.hasAttachment"
      type="select"
      variant="outline"
      :label="__('Attachments')"
      :options="getAttachmentOptions()"
    />
    <FormControl
      v-model="filter.isRead"
      type="select"
      variant="outline"
      :label="__('Read status')"
      :options="getReadStatusOptions()"
    />
    <FormControl
      v-model="mailExport.limit"
      :label="__('Max number of messages')"
      type="number"
      variant="outline"
      placeholder="1000"
    />
    <FormControl
      v-if="mailExport.limit && mailExport.limit > 0"
      v-model="mailExport.sort"
      :label="__('Start from')"
      type="select"
      variant="outline"
      :options="sortOptions"
    />
  </template>

  <Alert
    v-if="isExportRunning"
    :title="__('Export in progress. We’ll email you when it’s ready.')"
  />
  <ErrorMessage :message="exportError" />
  <!-- Both tabs' forms are mounted, and only the shown one's buttons go in the dialog -->
  <SettingsDialogActions v-if="isActive">
    <Button :label="exportLinkText" :href="exportHref" />
    <Button
      :label="__('Start export')"
      variant="solid"
      :loading="isExporting"
      :disabled="isExportBlocked"
      @click="createMailExportSubmit()"
    />
  </SettingsDialogActions>
</template>

<script setup lang="ts">
import { Alert, Button, ErrorMessage, FormControl, SettingsRow, Switch } from 'frappe-ui'
import { computed, onScopeDispose, reactive, ref } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { getAttachmentOptions, getReadStatusOptions } from '@/apps/mail/constants'
import { useMailSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import { utcDayEnd, utcDayStart } from '@/apps/mail/utils/datetime'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'

const { isActive } = defineProps<{
  /** Whether this is the form on show. Its buttons are the dialog's only while it is. */
  isActive: boolean
}>()

const store = userStore()
const { mailboxes } = store
const user = store.userResource
const socket = useMailSocket()
const mailExport = reactive<Omit<InputOf<typeof api.mail.exchanges.exportMail>, 'account'>>({
  format: 'jmap',
  archive_type: '.zip',
  sort: 'Received At (ASC)',
  limit: undefined,
})
const customSelection = ref(false)
const filter = reactive({
  inMailbox: '',
  after: '',
  before: '',
  hasAttachment: ' ',
  isRead: ' ',
})
const mailboxOptions = computed(() =>
  [
    {
      label: __(''),
      value: ' ',
    },
  ].concat(
    (mailboxes.data ?? []).map((m: { id: string; _name: string }) => ({
      label: m._name,
      value: m.id,
    })),
  ),
)
const sortOptions = computed(() => [
  {
    label: __('Oldest messages'),
    value: 'Received At (ASC)',
  },
  {
    label: __('Newest messages'),
    value: 'Received At (DESC)',
  },
])
const createMailExport = useMutation(api.mail.exchanges.exportMail)
async function createMailExportSubmit() {
  const cleanedFilter = Object.fromEntries(
    Object.entries(filter)
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
      .filter(([, v]) => Boolean(v)),
  )
  if (typeof cleanedFilter.after === 'string' && cleanedFilter.after)
    cleanedFilter.after = utcDayStart(cleanedFilter.after)
  if (typeof cleanedFilter.before === 'string' && cleanedFilter.before)
    cleanedFilter.before = utcDayEnd(cleanedFilter.before)
  const input: InputOf<typeof api.mail.exchanges.exportMail> = {
    account: store.accountId,
    ...mailExport,
    limit: mailExport.limit || undefined,
    filter: cleanedFilter,
  }
  await createMailExport.run(input)
  await ongoingExport.refetch().catch(() => {})
}
const ongoingExport = useQuery(api.mail.exchanges.ongoing, () =>
  user.data && store.accountId
    ? {
        doctype: 'Mail Exchange',
        fieldname: 'name',
        filters: {
          user: user.data!.name,
          operation: 'Export',
          status: ['in', ['Queued', 'In Progress']],
        },
      }
    : false,
)
const onExchangeCompleted = (payload: { action: 'Import' | 'Export' }) => {
  if (payload.action === 'Export') ongoingExport.refetch().catch(() => {})
}
socket.on('mail_exchange_completed', onExchangeCompleted)
onScopeDispose(() => socket.off('mail_exchange_completed', onExchangeCompleted))
const isExportRunning = computed(() => Boolean(ongoingExport.data?.name))
const isExporting = computed(() => isExportRunning.value || createMailExport.isPending)
const isExportBlocked = computed(
  () => ongoingExport.isFetching || Boolean(ongoingExport.error) || createMailExport.isPending,
)
const exportError = computed(() => createMailExport.error?.message)
const exportHref = computed(() => {
  if (ongoingExport.data?.name) return `/mail/mail-exchanges/${ongoingExport.data.name}`
  return '/mail/mail-exchanges?operation=Export'
})
const exportLinkText = computed(() => {
  if (ongoingExport.data?.name) return __('Track status')
  return __('View history')
})
const FORMAT_OPTIONS = ['jmap', 'mbox', 'maildir', 'maildir-nested']
const ARCHIVE_TYPE_OPTIONS = ['.zip', '.tgz', '.tar.gz']
</script>
