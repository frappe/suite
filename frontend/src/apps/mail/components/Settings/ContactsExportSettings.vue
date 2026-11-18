<template>
  <FormControl
    v-model="contactsExport.format"
    :label="__('Format')"
    type="select"
    variant="outline"
    :options="FORMAT_OPTIONS"
  />
  <FormControl
    v-model="contactsExport.archive_type"
    :label="__('Archive type')"
    type="select"
    variant="outline"
    :options="ARCHIVE_TYPE_OPTIONS"
  />
  <SettingsRow
    class="!py-0"
    :title="__('Custom selection')"
    :description="__('Apply filters to select specific contacts for export.')"
  >
    <Switch v-model="customSelection" />
  </SettingsRow>
  <template v-if="customSelection">
    <FormControl
      v-model="filter.inAddressBook"
      :label="__('Address book')"
      type="select"
      variant="outline"
      :options="addressBookOptions"
    />
    <FormControl v-model="filter.name" type="text" variant="outline" :label="__('Name')" />
    <FormControl v-model="filter.email" type="text" variant="outline" :label="__('Email')" />
    <FormControl
      v-model="contactsExport.limit"
      :label="__('Max number of contacts')"
      type="number"
      variant="outline"
      placeholder="1000"
    />
  </template>

  <Alert
    v-if="isExportRunning"
    :title="__('Export in progress. We’ll email you when it’s ready.')"
  />
  <ErrorMessage :message="exportError" />
  <!-- Both tabs' forms are mounted, and only the shown one's buttons go in the dialog -->
  <SettingsDialogActions v-if="isActive">
    <Button :label="exportLinkText" :href="exportHref" />
    <Button
      :label="__('Start export')"
      variant="solid"
      :loading="isExporting"
      :disabled="isExportBlocked"
      @click="createContactsExportSubmit()"
    />
  </SettingsDialogActions>
</template>

<script setup lang="ts">
import { Alert, Button, ErrorMessage, FormControl, SettingsRow, Switch } from 'frappe-ui'
import { computed, onScopeDispose, reactive, ref } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useMailSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'

const { isActive } = defineProps<{
  /** Whether this is the form on show. Its buttons are the dialog's only while it is. */
  isActive: boolean
}>()

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
const isExportRunning = computed(() => Boolean(ongoingExport.data?.name))
const isExporting = computed(() => isExportRunning.value || createContactsExport.isPending)
const isExportBlocked = computed(
  () => ongoingExport.isFetching || Boolean(ongoingExport.error) || createContactsExport.isPending,
)
const exportError = computed(() => createContactsExport.error?.message)
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
