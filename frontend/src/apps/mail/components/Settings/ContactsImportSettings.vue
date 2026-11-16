<!--
  The Import side of Mail > Import & export, for contacts: a file of contacts goes into one address
  book. The file uploads first; Start import then queues the job, and the status line tracks it.
-->
<template>
  <SettingsRow :title="__('Format')" :description="__('The kind of file you are importing')">
    <Select
      :model-value="contactsImport.format"
      :options="FORMATS"
      @update:model-value="selectFormat"
    />
  </SettingsRow>
  <SettingsRow
    :title="__('Address book')"
    :description="__('The address book the contacts go into')"
  >
    <Select
      :model-value="contactsImport.address_book ?? ''"
      :options="addressBookOptions"
      class="max-w-48 sm:max-w-64"
      :placeholder="__('Select address book')"
      @update:model-value="selectAddressBook"
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
  <SettingsJobStatus :status="importSubtitle" :href="importHref" :link-label="importLinkText">
    <Button
      variant="solid"
      :label="__('Start import')"
      :loading="Boolean(ongoingImport.data?.name) || createContactsImport.isPending"
      :disabled="ongoingImport.isFetching || Boolean(ongoingImport.error) || !contactsImport.file"
      @click="createContactsImportSubmit()"
    />
  </SettingsJobStatus>
  <ErrorMessage
    v-if="createContactsImport.error"
    class="py-2"
    :message="createContactsImport.error?.message"
  />
</template>

<script setup lang="ts">
import { Button, ErrorMessage, Select, SettingsRow } from 'frappe-ui'
import { computed, onScopeDispose, reactive, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useMailSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import { raiseError } from '@/apps/mail/utils'
import { SettingsJobStatus } from '@/platform/settings-tab'
import { useChunkedUpload } from '@/utils/useChunkedUpload'

type ImportInput = InputOf<typeof api.mail.exchanges.importContacts>

const FORMATS: { label: string; value: ImportInput['format'] }[] = [
  { label: __('vCard (.vcf)'), value: 'vcf' },
  { label: __('JMAP archive'), value: 'jmap' },
]

const store = userStore()
const user = store.userResource
const socket = useMailSocket()
const contactsImport = reactive<Omit<ImportInput, 'account'>>({
  format: 'vcf',
  file: '',
  address_book: '',
})
const fileName = ref('')

function selectFormat(value?: string | number | null) {
  const format = FORMATS.find((option) => option.value === value)?.value
  if (format) contactsImport.format = format
}

function selectAddressBook(value?: string | number | null) {
  if (typeof value === 'string') contactsImport.address_book = value
}
const fileInput = ref<HTMLInputElement | null>(null)
const { uploading, progress, upload } = useChunkedUpload()
const acceptTypes = computed(() => (contactsImport.format === 'vcf' ? '.vcf' : '.zip,.tgz,.tar.gz'))

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
    contactsImport.file = uploaded.file_url
    fileName.value = file.name
  } catch (error) {
    raiseError(error)
  }
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
const fileDescription = computed(() => {
  if (contactsImport.file) return __('Uploaded: {0}', [fileName.value])
  if (contactsImport.format === 'vcf') return __('A .vcf file')
  return __('A .zip, .tar or .tgz archive')
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
const importSubtitle = computed(() => {
  if (ongoingImport.data?.name) return __("Import in progress. We'll email you when it's ready.")
  return __('No imports in progress.')
})
const importHref = computed(() => {
  if (ongoingImport.data?.name) return `/mail/contacts-exchanges/${ongoingImport.data.name}`
  return '/mail/contacts-exchanges?operation=Import'
})
const importLinkText = computed(() => {
  if (ongoingImport.data?.name) return __('Track status')
  return __('View history')
})
</script>
