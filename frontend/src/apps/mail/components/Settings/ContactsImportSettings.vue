<template>
  <div class="flex flex-col gap-4 py-3.5">
    <div class="grid gap-4 sm:grid-cols-2">
      <FormControl
        v-model="contactsImport.format"
        :label="__('Format')"
        type="select"
        :options="FORMAT_OPTIONS"
        required
      />
      <FormControl
        v-model="contactsImport.address_book"
        :label="__('Address book')"
        type="select"
        :options="addressBookOptions"
      />
    </div>
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      :accept="acceptTypes"
      @change="onFileSelected"
    />
    <div class="flex flex-col gap-1.5">
      <span class="text-xs text-ink-gray-5">{{ __('File') }}</span>
      <div class="flex items-center gap-3">
        <Button
          icon-left="lucide-upload"
          :label="uploading ? __('Uploading ({0}%)', [progress]) : __('Choose file')"
          :loading="uploading"
          @click="fileInput?.click()"
        />
        <span class="min-w-0 truncate text-p-sm text-ink-gray-5">{{ fileUploadSubtitle }}</span>
      </div>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-p-sm text-ink-gray-5">
        {{ importSubtitle }}
        <a class="text-ink-gray-7 underline underline-offset-2" :href="importHref" target="_blank">
          {{ importLinkText }}
        </a>
      </p>
      <Button
        variant="solid"
        :label="__('Start import')"
        :loading="Boolean(ongoingImport.data?.name) || createContactsImport.isPending"
        :disabled="ongoingImport.isFetching || Boolean(ongoingImport.error) || !contactsImport.file"
        @click="createContactsImportSubmit()"
      />
    </div>
    <ErrorMessage
      v-if="createContactsImport.error"
      :message="createContactsImport.error?.message"
    />
  </div>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, onScopeDispose, reactive, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useMailSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import { raiseError } from '@/apps/mail/utils'
import { useChunkedUpload } from '@/utils/useChunkedUpload'

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
const fileUploadSubtitle = computed(() => {
  if (contactsImport.file) return __('Uploaded {0}', [contactsImport.file.split('/').pop() ?? ''])
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
const FORMAT_OPTIONS = ['vcf', 'jmap']
</script>
