<template>
  <FormControl
    v-model="mailImport.format"
    :label="__('Format')"
    type="select"
    variant="outline"
    :options="FORMAT_OPTIONS"
    required
  />
  <template v-if="['eml', 'mbox', 'maildir'].includes(mailImport.format)">
    <FormControl
      v-model="mailImport.mailbox"
      :label="__('Folder')"
      type="select"
      variant="outline"
      :options="mailboxOptions"
    />
    <FormControl
      v-model="mailImport.seen"
      :label="__('Mark as read')"
      type="select"
      variant="outline"
      :options="markAsReadOptions"
    />
  </template>
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
  <!-- Both tabs' forms are mounted, and only the shown one's buttons go in the dialog -->
  <SettingsDialogActions v-if="isActive">
    <Button :label="importLinkText" :href="importHref" />
    <Button
      :label="__('Start import')"
      variant="solid"
      :loading="isImporting"
      :disabled="isImportBlocked"
      @click="createMailImportSubmit()"
    />
  </SettingsDialogActions>
</template>

<script setup lang="ts">
import { Alert, Button, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, onScopeDispose, reactive, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useMailSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import SettingsFileField from '@/platform/settings/SettingsFileField.vue'
import { useChunkedUpload } from '@/utils/useChunkedUpload'

const { isActive } = defineProps<{
  /** Whether this is the form on show. Its buttons are the dialog's only while it is. */
  isActive: boolean
}>()

const store = userStore()
const { mailboxes } = store
const user = store.userResource
const socket = useMailSocket()
const mailImport = reactive<Omit<InputOf<typeof api.mail.exchanges.importMail>, 'account'>>({
  format: 'eml',
  file: '',
  mailbox: '',
  seen: true,
})
const { progress, upload, uploading } = useChunkedUpload()
const acceptTypes = computed(() => (mailImport.format === 'eml' ? '.eml' : '.zip,.tgz,.tar.gz'))

// Upload in chunks so large import archives aren't blocked by the web server's request-size limit.
async function uploadFile(file: File) {
  const uploaded = await upload(file, { private: true })
  mailImport.file = uploaded.file_url
}

const mailboxOptions = computed(() =>
  (mailboxes.data ?? []).map((m: { id: string; _name: string }) => ({
    label: m._name,
    value: m.id,
  })),
)
const markAsReadOptions = computed(() => [
  {
    label: __('Yes'),
    value: true,
  },
  {
    label: __('No'),
    value: false,
  },
])
const fileUploadSubtitle = computed(() => {
  if (mailImport.format === 'eml') return __('Supported file format: .eml')
  return __('Supported file formats: .zip, .tar, .tgz')
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
const isImportRunning = computed(() => Boolean(ongoingImport.data?.name))
const isImporting = computed(() => isImportRunning.value || createMailImport.isPending)
// While a file uploads, the form still holds the one picked before it
const isImportBlocked = computed(
  () =>
    ongoingImport.isFetching || Boolean(ongoingImport.error) || uploading.value || !mailImport.file,
)
const importError = computed(() => createMailImport.error?.message)
const importHref = computed(() => {
  if (ongoingImport.data?.name) return `/mail/mail-exchanges/${ongoingImport.data.name}`
  return '/mail/mail-exchanges?operation=Import'
})
const importLinkText = computed(() => {
  if (ongoingImport.data?.name) return __('Track status')
  return __('View history')
})
const FORMAT_OPTIONS = ['eml', 'jmap', 'mbox', 'maildir', 'maildir-nested']
</script>
