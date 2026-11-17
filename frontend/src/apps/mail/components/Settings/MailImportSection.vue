<!--
  The Import section of Mail > Import & export, for mail: a file of messages goes into one folder.
  The file uploads first; Start import then queues the job, and the status line tracks it.
-->
<template>
  <SettingsSection
    :title="__('Mail')"
    :description="__('Messages from another mail service, in .eml, mbox or Maildir files')"
  >
    <SettingsRow :title="__('Format')" :description="__('The kind of file you are importing')">
      <Select
        :model-value="mailImport.format"
        :options="FORMATS"
        @update:model-value="selectFormat"
      />
    </SettingsRow>
    <!-- The folder and read state apply to .eml, mbox and Maildir imports only. -->
    <template v-if="FOLDER_FORMATS.includes(mailImport.format)">
      <SettingsRow :title="__('Folder')" :description="__('The folder the messages go into')">
        <Select
          :model-value="mailImport.mailbox ?? ''"
          :options="mailboxOptions"
          class="max-w-48 sm:max-w-64"
          :placeholder="__('Select folder')"
          @update:model-value="selectMailbox"
        />
      </SettingsRow>
      <SettingsRow
        :title="__('Mark as read')"
        :description="__('Import the messages as already read')"
      >
        <Switch
          :model-value="mailImport.seen ?? true"
          @update:model-value="(on: boolean) => (mailImport.seen = on)"
        />
      </SettingsRow>
    </template>
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
    <SettingsJobStatus :status="importSubtitle" :href="importHref" :link-label="importLinkText">
      <Button
        variant="solid"
        :label="__('Start import')"
        :loading="Boolean(ongoingImport.data?.name) || createMailImport.isPending"
        :disabled="ongoingImport.isFetching || Boolean(ongoingImport.error) || !mailImport.file"
        @click="createMailImportSubmit()"
      />
    </SettingsJobStatus>
    <ErrorMessage
      v-if="createMailImport.error"
      class="py-2"
      :message="createMailImport.error?.message"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, Select, SettingsRow, Switch } from 'frappe-ui'
import { computed, onScopeDispose, reactive, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useMailSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import { raiseError } from '@/apps/mail/utils'
import { SettingsJobStatus, SettingsSection } from '@/platform/settings-tab'
import { useChunkedUpload } from '@/utils/useChunkedUpload'

type ImportInput = InputOf<typeof api.mail.exchanges.importMail>

const FORMATS: { label: string; value: ImportInput['format'] }[] = [
  { label: __('Email files (.eml)'), value: 'eml' },
  { label: __('JMAP archive'), value: 'jmap' },
  { label: __('mbox'), value: 'mbox' },
  { label: __('Maildir'), value: 'maildir' },
  { label: __('Maildir, nested folders'), value: 'maildir-nested' },
]

const FOLDER_FORMATS: ImportInput['format'][] = ['eml', 'mbox', 'maildir']

const store = userStore()
const { mailboxes } = store
const user = store.userResource
const socket = useMailSocket()
const mailImport = reactive<Omit<ImportInput, 'account'>>({
  format: 'eml',
  file: '',
  mailbox: '',
  seen: true,
})
const fileName = ref('')

function selectFormat(value?: string | number | null) {
  const format = FORMATS.find((option) => option.value === value)?.value
  if (format) mailImport.format = format
}

function selectMailbox(value?: string | number | null) {
  if (typeof value === 'string') mailImport.mailbox = value
}

const fileInput = ref<HTMLInputElement | null>(null)
const { uploading, progress, upload } = useChunkedUpload()
const acceptTypes = computed(() => (mailImport.format === 'eml' ? '.eml' : '.zip,.tgz,.tar.gz'))

// Upload in chunks so large import archives aren't blocked by the web server's request-size limit.
const onFileSelected = async (event: Event) => {
  const checkedEventTarget = event.target
  if (!(checkedEventTarget instanceof HTMLInputElement)) return

  const input = checkedEventTarget
  const file = input.files?.[0]
  input.value = '' // let the same file be re-selected after an error
  if (!file) return
  try {
    const uploaded = await upload(file, {
      private: true,
    })
    mailImport.file = uploaded.file_url
    fileName.value = file.name
  } catch (error) {
    raiseError(error)
  }
}
const mailboxOptions = computed(() =>
  (mailboxes.data ?? []).map((m: { id: string; _name: string }) => ({
    label: m._name,
    value: m.id,
  })),
)
const fileDescription = computed(() => {
  if (mailImport.file) return __('Uploaded: {0}', [fileName.value])
  if (mailImport.format === 'eml') return __('An .eml file')
  return __('A .zip, .tar or .tgz archive')
})
watch(
  mailboxOptions,
  (options) => {
    if (options.length > 0 && !mailImport.mailbox) {
      mailImport.mailbox = options[0].value
    }
  },
  {
    immediate: true,
  },
)
const createMailImport = useMutation(api.mail.exchanges.importMail)
async function createMailImportSubmit() {
  const input: InputOf<typeof api.mail.exchanges.importMail> = {
    account: store.accountId,
    ...mailImport,
  }
  await createMailImport.run(input)
  await ongoingImport.refetch().catch(() => {})
}
const ongoingImport = useQuery(api.mail.exchanges.ongoing, () =>
  user.data && store.accountId
    ? {
        doctype: 'Mail Exchange',
        fieldname: 'name',
        filters: {
          user: user.data!.name,
          operation: 'Import',
          status: ['in', ['Queued', 'In Progress']],
        },
      }
    : false,
)
const onExchangeCompleted = (payload: { action: 'Import' | 'Export' }) => {
  if (payload.action === 'Import') ongoingImport.refetch().catch(() => {})
}
socket.on('mail_exchange_completed', onExchangeCompleted)
onScopeDispose(() => socket.off('mail_exchange_completed', onExchangeCompleted))
const importSubtitle = computed(() => {
  if (ongoingImport.data?.name) return __("Import in progress. We'll email you when it's ready.")
  return __('No imports in progress.')
})
const importHref = computed(() => {
  if (ongoingImport.data?.name) return `/mail/mail-exchanges/${ongoingImport.data.name}`
  return '/mail/mail-exchanges?operation=Import'
})
const importLinkText = computed(() => {
  if (ongoingImport.data?.name) return __('Track status')
  return __('View history')
})
</script>
