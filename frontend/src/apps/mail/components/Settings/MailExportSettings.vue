<template>
  <div class="flex flex-col gap-4 py-3.5">
    <div class="grid gap-4 sm:grid-cols-2">
      <FormControl
        v-model="mailExport.format"
        :label="__('Format')"
        type="select"
        :options="FORMAT_OPTIONS"
      />
      <FormControl
        v-model="mailExport.archive_type"
        :label="__('Archive type')"
        type="select"
        :options="ARCHIVE_TYPE_OPTIONS"
      />
    </div>
    <SettingsRow
      class="!py-0"
      :title="__('Only some mail')"
      :description="__('Choose a folder, dates or other filters')"
    >
      <Switch v-model="customSelection" />
    </SettingsRow>
    <div v-if="customSelection" class="grid gap-4 sm:grid-cols-2">
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
      <FormControl v-model="filter.after" type="date" :label="__('From date')" />
      <FormControl v-model="filter.before" type="date" :label="__('To date')" />
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
        :options="sortOptions"
      />
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-p-sm text-ink-gray-5">
        {{ exportSubtitle }}
        <a class="text-ink-gray-7 underline underline-offset-2" :href="exportHref" target="_blank">
          {{ exportLinkText }}
        </a>
      </p>
      <Button
        variant="solid"
        :label="__('Start export')"
        :loading="Boolean(ongoingExport.data?.name) || createMailExport.isPending"
        :disabled="
          ongoingExport.isFetching || Boolean(ongoingExport.error) || createMailExport.isPending
        "
        @click="createMailExportSubmit()"
      />
    </div>
    <ErrorMessage v-if="createMailExport.error" :message="createMailExport.error?.message" />
  </div>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormControl, SettingsRow, Switch } from 'frappe-ui'
import { computed, onScopeDispose, reactive, ref } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { getAttachmentOptions, getReadStatusOptions } from '@/apps/mail/constants'
import { useMailSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import { utcDayEnd, utcDayStart } from '@/apps/mail/utils/datetime'

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
    label: __('Oldest Emails'),
    value: 'Received At (ASC)',
  },
  {
    label: __('Newest Emails'),
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
const exportSubtitle = computed(() => {
  if (ongoingExport.data?.name) return __("Export in progress. We'll email you when it's ready.")
  return __('No exports in progress.')
})
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
