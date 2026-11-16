<template>
  <div class="flex flex-col gap-4 py-3.5">
    <div class="grid gap-4 sm:grid-cols-2">
      <FormControl
        v-model="contactsExport.format"
        :label="__('Format')"
        type="select"
        :options="FORMAT_OPTIONS"
      />
      <FormControl
        v-model="contactsExport.archive_type"
        :label="__('Archive type')"
        type="select"
        :options="ARCHIVE_TYPE_OPTIONS"
      />
    </div>
    <SettingsRow
      class="!py-0"
      :title="__('Only some contacts')"
      :description="__('Choose an address book, a name or an email')"
    >
      <Switch v-model="customSelection" />
    </SettingsRow>
    <div v-if="customSelection" class="grid gap-4 sm:grid-cols-2">
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
        :loading="Boolean(ongoingExport.data?.name) || createContactsExport.isPending"
        :disabled="
          ongoingExport.isFetching || Boolean(ongoingExport.error) || createContactsExport.isPending
        "
        @click="createContactsExportSubmit()"
      />
    </div>
    <ErrorMessage
      v-if="createContactsExport.error"
      :message="createContactsExport.error?.message"
    />
  </div>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormControl, SettingsRow, Switch } from 'frappe-ui'
import { computed, onScopeDispose, reactive, ref } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useMailSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'

const store = userStore()
const user = store.userResource
const socket = useMailSocket()
const contactsExport = reactive<Omit<InputOf<typeof api.mail.exchanges.exportContacts>, 'account'>>(
  {
    format: 'jmap',
    archive_type: '.zip',
    limit: undefined,
  },
)
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
const FORMAT_OPTIONS = ['jmap', 'vcf']
const ARCHIVE_TYPE_OPTIONS = ['.zip', '.tgz', '.tar.gz']
</script>
