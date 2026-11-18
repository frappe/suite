<template>
  <FormControl
    v-model="contactsImport.format"
    :label="__('Format')"
    type="select"
    variant="outline"
    :options="FORMAT_OPTIONS"
    required
  />
  <FormControl
    v-model="contactsImport.address_book"
    :label="__('Address book')"
    type="select"
    variant="outline"
    :options="addressBookOptions"
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
  <!-- Both tabs' forms are mounted, and only the shown one's buttons go in the dialog -->
  <SettingsDialogActions v-if="isActive">
    <Button :label="importLinkText" :href="importHref" />
    <Button
      :label="__('Start import')"
      variant="solid"
      :loading="isImporting"
      :disabled="isImportBlocked"
      @click="createContactsImportSubmit()"
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
const user = store.userResource
const socket = useMailSocket()
const contactsImport = reactive<Omit<InputOf<typeof api.mail.exchanges.importContacts>, 'account'>>(
  {
    format: 'vcf',
    file: '',
    address_book: '',
  },
)
const { progress, upload } = useChunkedUpload()
const acceptTypes = computed(() => (contactsImport.format === 'vcf' ? '.vcf' : '.zip,.tgz,.tar.gz'))

// Upload in chunks so large import archives aren't blocked by the web server's request-size limit.
async function uploadFile(file: File) {
  const uploaded = await upload(file, { private: true })
  contactsImport.file = uploaded.file_url
}

const addressBooks = useQuery(api.mail.addressBooks.list, () =>
  store.accountId
    ? {
        account: store.accountId,
      }
    : false,
)
watch(
  () => addressBooks.data,
  (data) => {
    if (!contactsImport.address_book && data?.length) contactsImport.address_book = data[0].id
  },
  {
    immediate: true,
  },
)
const addressBookOptions = computed(() =>
  (addressBooks.data || []).map((b: { id: string; _name: string }) => ({
    label: b._name,
    value: b.id,
  })),
)
const fileUploadSubtitle = computed(() => {
  if (contactsImport.format === 'vcf') return __('Supported file format: .vcf')
  return __('Supported file formats: .zip, .tar, .tgz')
})
const createContactsImport = useMutation(api.mail.exchanges.importContacts)
async function createContactsImportSubmit() {
  const input: InputOf<typeof api.mail.exchanges.importContacts> = {
    account: store.accountId,
    ...contactsImport,
  }
  await createContactsImport.run(input)
  await ongoingImport.refetch().catch(() => {})
}
const ongoingImport = useQuery(api.mail.exchanges.ongoing, () =>
  user.data && store.accountId
    ? {
        doctype: 'Contacts Exchange',
        fieldname: 'name',
        filters: {
          user: user.data!.name,
          account: store.accountId,
          operation: 'Import',
          status: ['in', ['Queued', 'In Progress']],
        },
      }
    : false,
)
const onExchangeCompleted = (payload: { action: 'Import' | 'Export' }) => {
  if (payload.action === 'Import') ongoingImport.refetch().catch(() => {})
}
socket.on('contacts_exchange_completed', onExchangeCompleted)
onScopeDispose(() => socket.off('contacts_exchange_completed', onExchangeCompleted))
const isImportRunning = computed(() => Boolean(ongoingImport.data?.name))
const isImporting = computed(() => isImportRunning.value || createContactsImport.isPending)
const isImportBlocked = computed(
  () => ongoingImport.isFetching || Boolean(ongoingImport.error) || !contactsImport.file,
)
const importError = computed(() => createContactsImport.error?.message)
const importHref = computed(() => {
  if (ongoingImport.data?.name) return `/mail/contacts-exchanges/${ongoingImport.data.name}`
  return '/mail/contacts-exchanges?operation=Import'
})
const importLinkText = computed(() => {
  if (ongoingImport.data?.name) return __('Track status')
  return __('View history')
})
const FORMAT_OPTIONS = ['vcf', 'jmap']
</script>
