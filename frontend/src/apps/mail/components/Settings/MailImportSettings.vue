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
      :label="__('Mark as Read')"
      type="select"
      variant="outline"
      :options="markAsReadOptions"
    />
  </template>
  <input
    ref="fileInput"
    type="file"
    class="hidden"
    :accept="acceptTypes"
    @change="onFileSelected"
  />
  <Button
    class="w-full"
    :label="uploading ? __('Uploading ({0}%)', [progress]) : __('Upload File')"
    :loading="uploading"
    @click="fileInput?.click()"
  />
  <p class="text-ink-gray-5 mt-2 flex text-sm">{{ fileUploadSubtitle }}</p>

  <Button
    class="min-h-7"
    :label="__('Create Import')"
    variant="solid"
    :loading="Boolean(ongoingImport.data?.name) || createMailImport.isPending"
    :disabled="ongoingImport.isFetching || Boolean(ongoingImport.error) || !mailImport.file"
    @click="createMailImportSubmit()"
  />
  <div class="!mt-3 space-x-1 text-base">
    <span class="text-ink-gray-5">{{ importSubtitle }}</span>
    <a class="hover:underline" :href="importHref" target="_blank">
      {{ importLinkText }}
    </a>
  </div>
  <ErrorMessage
    v-if="createMailImport.error"
    :message="createMailImport.error?.message"
    class="mb-2.5"
  />
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
const { mailboxes } = store
const user = store.userResource
const socket = useMailSocket()
const mailImport = reactive<Omit<InputOf<typeof api.mail.exchanges.importMail>, 'account'>>({
  format: 'eml',
  file: '',
  mailbox: '',
  seen: true,
})
const fileInput = ref<HTMLInputElement | null>(null)
const { uploading, progress, upload } = useChunkedUpload()
const acceptTypes = computed(() => (mailImport.format === 'eml' ? '.eml' : '.zip,.tgz,.tar.gz'))

// Upload in chunks so large import archives aren't blocked by the web server's request-size limit.
const onFileSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // let the same file be re-selected after an error
  if (!file) return
  try {
    const uploaded = await upload(file, {
      private: true,
    })
    mailImport.file = uploaded.file_url
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
  if (mailImport.file) return __('File uploaded: {0}', [mailImport.file])
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
const FORMAT_OPTIONS = ['eml', 'jmap', 'mbox', 'maildir', 'maildir-nested']
</script>
