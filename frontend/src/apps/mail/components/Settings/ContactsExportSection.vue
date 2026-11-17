<!--
  The Export section of Mail > Import & export, for contacts: the account's contacts as an archive,
  emailed when ready. "Only some contacts" narrows the export by address book, name or email.
-->
<template>
  <SettingsSection :title="__('Contacts')" :description="__('An archive of your contacts')">
    <SettingsRow :title="__('Format')" :description="__('The kind of file the contacts go into')">
      <Select
        :model-value="contactsExport.format"
        :options="FORMATS"
        @update:model-value="selectFormat"
      />
    </SettingsRow>
    <SettingsRow :title="__('Archive type')" :description="__('How the files are packed')">
      <Select
        :model-value="contactsExport.archive_type"
        :options="ARCHIVE_TYPES"
        @update:model-value="selectArchiveType"
      />
    </SettingsRow>
    <SettingsRow
      :title="__('Only some contacts')"
      :description="__('Choose an address book, a name or an email')"
    >
      <Switch v-model="customSelection" />
    </SettingsRow>
    <div v-if="customSelection" class="grid gap-4 py-3.5 sm:grid-cols-2">
      <FormControl
        v-model="filter.inAddressBook"
        :label="__('Address book')"
        type="select"
        :options="addressBookOptions"
      />
      <FormControl v-model="filter.name" type="text" :label="__('Name')" />
      <FormControl v-model="filter.email" type="text" :label="__('Email')" />
      <FormControl
        v-model="contactsExport.limit"
        :label="__('Most contacts')"
        type="number"
        placeholder="1000"
      />
    </div>
    <SettingsJobStatus :status="exportSubtitle" :href="exportHref" :link-label="exportLinkText">
      <Button
        variant="solid"
        :label="__('Start export')"
        :loading="Boolean(ongoingExport.data?.name) || createContactsExport.isPending"
        :disabled="
          ongoingExport.isFetching || Boolean(ongoingExport.error) || createContactsExport.isPending
        "
        @click="createContactsExportSubmit()"
      />
    </SettingsJobStatus>
    <ErrorMessage
      v-if="createContactsExport.error"
      class="py-2"
      :message="createContactsExport.error?.message"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormControl, Select, SettingsRow, Switch } from 'frappe-ui'
import { computed, onScopeDispose, reactive, ref } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useMailSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import { SettingsJobStatus, SettingsSection } from '@/platform/settings-tab'

type ExportInput = InputOf<typeof api.mail.exchanges.exportContacts>

const FORMATS: { label: string; value: ExportInput['format'] }[] = [
  { label: __('JMAP archive'), value: 'jmap' },
  { label: __('vCard (.vcf)'), value: 'vcf' },
]
const ARCHIVE_TYPES: { label: string; value: ExportInput['archive_type'] }[] = [
  { label: '.zip', value: '.zip' },
  { label: '.tgz', value: '.tgz' },
  { label: '.tar.gz', value: '.tar.gz' },
]

const store = userStore()
const user = store.userResource
const socket = useMailSocket()
const contactsExport = reactive<Omit<ExportInput, 'account'>>({
  format: 'jmap',
  archive_type: '.zip',
  limit: undefined,
})

function selectFormat(value?: string | number | null) {
  const format = FORMATS.find((option) => option.value === value)?.value
  if (format) contactsExport.format = format
}

function selectArchiveType(value?: string | number | null) {
  const type = ARCHIVE_TYPES.find((option) => option.value === value)?.value
  if (type) contactsExport.archive_type = type
}
const customSelection = ref(false)
const filter = reactive({
  inAddressBook: '',
  name: '',
  email: '',
})
const addressBooks = useQuery(api.mail.addressBooks.list, () =>
  store.accountId
    ? {
        account: store.accountId,
      }
    : false,
)
const addressBookOptions = computed(() =>
  [
    {
      label: __(''),
      value: ' ',
    },
  ].concat(
    (addressBooks.data || []).map((b: { id: string; _name: string }) => ({
      label: b._name,
      value: b.id,
    })),
  ),
)
const createContactsExport = useMutation(api.mail.exchanges.exportContacts)
async function createContactsExportSubmit() {
  const cleanedFilter = Object.fromEntries(
    Object.entries(filter)
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
      .filter(([, v]) => Boolean(v)),
  )
  const input: InputOf<typeof api.mail.exchanges.exportContacts> = {
    account: store.accountId,
    ...contactsExport,
    limit: contactsExport.limit || undefined,
    filter: cleanedFilter,
  }
  await createContactsExport.run(input)
  await ongoingExport.refetch().catch(() => {})
}
const ongoingExport = useQuery(api.mail.exchanges.ongoing, () =>
  user.data && store.accountId
    ? {
        doctype: 'Contacts Exchange',
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
socket.on('contacts_exchange_completed', onExchangeCompleted)
onScopeDispose(() => socket.off('contacts_exchange_completed', onExchangeCompleted))
const exportSubtitle = computed(() => {
  if (ongoingExport.data?.name) return __("Export in progress. We'll email you when it's ready.")
  return __('No exports in progress.')
})
const exportHref = computed(() => {
  if (ongoingExport.data?.name) return `/mail/contacts-exchanges/${ongoingExport.data.name}`
  return '/mail/contacts-exchanges?operation=Export'
})
const exportLinkText = computed(() => {
  if (ongoingExport.data?.name) return __('Track status')
  return __('View history')
})
</script>
