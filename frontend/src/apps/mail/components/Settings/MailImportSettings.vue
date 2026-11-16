<template>
  <div class="flex flex-col gap-4 py-3.5">
    <FormControl
      v-model="mailImport.format"
      :label="__('Format')"
      type="select"
      :options="FORMAT_OPTIONS"
      required
    />
    <div
      v-if="['eml', 'mbox', 'maildir'].includes(mailImport.format)"
      class="grid gap-4 sm:grid-cols-2"
    >
      <FormControl
        v-model="mailImport.mailbox"
        :label="__('Folder')"
        type="select"
        :options="mailboxOptions"
      />
      <FormControl
        v-model="mailImport.seen"
        :label="__('Mark as read')"
        type="select"
        :options="markAsReadOptions"
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
        :loading="Boolean(ongoingImport.data?.name) || createMailImport.isPending"
        :disabled="ongoingImport.isFetching || Boolean(ongoingImport.error) || !mailImport.file"
        @click="createMailImportSubmit()"
      />
    </div>
    <ErrorMessage v-if="createMailImport.error" :message="createMailImport.error?.message" />
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
  if (mailImport.file) return __('Uploaded {0}', [mailImport.file.split('/').pop() ?? ''])
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
