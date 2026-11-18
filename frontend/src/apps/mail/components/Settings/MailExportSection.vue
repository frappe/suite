<!--
  The Export section of Mail > Import & export, for mail: the account's messages as an archive, emailed
  when ready. "Only some mail" narrows the export by folder, dates and other filters.
-->
<template>
  <SettingsSection
    :title="__('Mail')"
    :description="__('An archive of your messages, to keep or to move to another service')"
  >
    <SettingsRow :title="__('Format')" :description="__('The kind of file the messages go into')">
      <Select
        :model-value="mailExport.format"
        :options="FORMATS"
        @update:model-value="selectFormat"
      />
    </SettingsRow>
    <SettingsRow :title="__('Archive type')" :description="__('How the files are packed')">
      <Select
        :model-value="mailExport.archive_type"
        :options="ARCHIVE_TYPES"
        @update:model-value="selectArchiveType"
      />
    </SettingsRow>
    <SettingsRow
      :title="__('Only some mail')"
      :description="__('Choose a folder, dates or other filters')"
    >
      <Switch v-model="customSelection" />
    </SettingsRow>
    <div v-if="customSelection" class="grid gap-4 py-3.5 sm:grid-cols-2">
      <FormControl
        v-model="filter.inMailbox"
        :label="__('Folder')"
        type="select"
        :options="mailboxOptions"
      />
      <FormControl
        v-model="filter.hasAttachment"
        type="select"
        :label="__('Attachments')"
        :options="getAttachmentOptions()"
      />
      <FormControl v-model="filter.after" type="date" :label="__('From')" />
      <FormControl v-model="filter.before" type="date" :label="__('To')" />
      <FormControl
        v-model="filter.isRead"
        type="select"
        :label="__('Read status')"
        :options="getReadStatusOptions()"
      />
      <FormControl
        v-model="mailExport.limit"
        :label="__('Most messages')"
        type="number"
        placeholder="1000"
      />
      <FormControl
        v-if="mailExport.limit && mailExport.limit > 0"
        v-model="mailExport.sort"
        :label="__('Start from')"
        type="select"
        :options="SORTS"
      />
    </div>
    <SettingsJobStatus
      operation="Export"
      :job="ongoingExport.data?.name"
      route-base="/mail/mail-exchanges"
    >
      <Button
        variant="solid"
        :label="__('Start export')"
        :loading="Boolean(ongoingExport.data?.name) || createMailExport.isPending"
        :disabled="
          ongoingExport.isFetching || Boolean(ongoingExport.error) || createMailExport.isPending
        "
        @click="createMailExportSubmit()"
      />
    </SettingsJobStatus>
    <ErrorMessage
      v-if="createMailExport.error"
      class="py-2"
      :message="createMailExport.error?.message"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormControl, Select, SettingsRow, Switch } from 'frappe-ui'
import { computed, reactive, ref } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { getAttachmentOptions, getReadStatusOptions } from '@/apps/mail/constants'
import { useMailSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import { utcDayEnd, utcDayStart } from '@/apps/mail/utils/datetime'
import { SettingsJobStatus, SettingsSection, useJobDoneRefetch } from '@/platform/settings-tab'

type ExportInput = InputOf<typeof api.mail.exchanges.exportMail>

const FORMATS: { label: string; value: ExportInput['format'] }[] = [
  { label: __('JMAP archive'), value: 'jmap' },
  { label: __('mbox'), value: 'mbox' },
  { label: __('Maildir'), value: 'maildir' },
  { label: __('Maildir, nested folders'), value: 'maildir-nested' },
]
const ARCHIVE_TYPES: { label: string; value: ExportInput['archive_type'] }[] = [
  { label: '.zip', value: '.zip' },
  { label: '.tgz', value: '.tgz' },
  { label: '.tar.gz', value: '.tar.gz' },
]
const SORTS: { label: string; value: ExportInput['sort'] }[] = [
  { label: __('Oldest messages'), value: 'Received At (ASC)' },
  { label: __('Newest messages'), value: 'Received At (DESC)' },
]

const store = userStore()
const { mailboxes } = store
const user = store.userResource
const socket = useMailSocket()
const mailExport = reactive<Omit<ExportInput, 'account'>>({
  format: 'jmap',
  archive_type: '.zip',
  sort: 'Received At (ASC)',
  limit: undefined,
})

function selectFormat(value?: string | number | null) {
  const format = FORMATS.find((option) => option.value === value)?.value
  if (format) mailExport.format = format
}

function selectArchiveType(value?: string | number | null) {
  const type = ARCHIVE_TYPES.find((option) => option.value === value)?.value
  if (type) mailExport.archive_type = type
}

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
useJobDoneRefetch(ongoingExport, { socket, event: 'mail_exchange_completed', operation: 'Export' })
</script>
