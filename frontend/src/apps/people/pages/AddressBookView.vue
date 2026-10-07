<template>
  <DashboardLayout
    v-if="addressBook.data"
    area="people"
    :breadcrumbs
    :badge-label="addressBook.data?.default ? __('Default') : ''"
    badge-theme="blue"
  >
    <template #actions>
      <Dropdown :options="dropdownOptions">
        <Button icon="lucide-more-horizontal" class="text-ink-gray-5" />
      </Dropdown>
    </template>
    <template #default>
      <DashboardCard
        :title="__('General Information')"
        :button-label="__('Edit')"
        @action="showEditGeneral = true"
      >
        <InformationField :label="__('Name')" :value="addressBook.data._name" />
        <InformationField
          :label="__('Description')"
          :value="addressBook.data.description ?? undefined"
        />
        <InformationField
          :label="__('Total Contacts')"
          :value="totalContacts.data?.toString() || '0'"
        />
      </DashboardCard>

      <DashboardCard :title="__('Contacts')" class="flex-1" @action="showAddContacts = true">
        <div class="space-y-4 p-4">
          <FormControl v-model="search" :placeholder="__('Search')" class="w-80">
            <template #prefix>
              <FeatherIcon name="search" class="text-ink-gray-5 w-4" />
            </template>
          </FormControl>

          <ListView
            v-if="rows"
            ref="listView"
            :columns="LIST_COLUMNS"
            :rows="rows"
            :options="LIST_OPTIONS"
            row-key="id"
            class="max-h-[73vh] min-h-72 flex-1 overflow-auto"
          >
            <ListHeader />
            <ListRows v-if="rows.length" @scroll="loadMoreContacts" />
            <ListEmptyState v-else />
            <ListSelectBanner>
              <template #actions>
                <Button
                  variant="ghost"
                  theme="red"
                  :label="__('Remove')"
                  @click="showRemoveContacts = true"
                />
              </template>
            </ListSelectBanner>
          </ListView>
        </div>
      </DashboardCard>
    </template>
  </DashboardLayout>

  <EditAddressBookModal
    v-if="addressBook.data"
    v-model="showEditGeneral"
    :name="addressBook.data._name"
    :description="addressBook.data.description ?? undefined"
    :is-default="!!addressBook.data.default"
    :save="saveGeneral"
  />
  <Dialog v-model:open="showDeleteAddressBook" v-bind="deleteAddressBookOptions" />

  <AddAddressBookContactsModal
    v-if="addressBook.data"
    v-model="showAddContacts"
    :current-contacts="rows.map((c) => c.id) || []"
    :save="addContacts"
  />
  <Dialog v-model:open="showRemoveContacts" v-bind="removeContactsOptions" />
</template>

<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { Button, Dialog, FormControl, usePageMeta } from 'frappe-ui'
import {
  Icon as FeatherIcon,
  ListEmptyState,
  ListHeader,
  ListRows,
  ListSelectBanner,
  ListView,
} from 'frappe-ui/experimental'
import { Pin, Trash2 } from 'lucide-vue-next'
import { computed, ref, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'

import { api, useInfiniteQuery, useMutation, useQuery } from '@/api'
import AddAddressBookContactsModal from '@/apps/people/components/Modals/AddAddressBookContactsModal.vue'
import EditAddressBookModal from '@/apps/people/components/Modals/EditAddressBookModal.vue'
import { contactRow } from '@/apps/people/contactRows'
import { userStore } from '@/apps/people/stores/user'
import { raiseToast } from '@/apps/people/utils'
import { DashboardCard, DashboardLayout, InformationField } from '@/platform/dashboard'
import { Dropdown } from '@/platform/feedback'
import { appPageMeta } from '@/platform/page-meta'

const { accountId, addressBookName } = defineProps<{
  accountId: string
  addressBookName: string
}>()
const router = useRouter()
userStore()
const showEditGeneral = ref(false)
const showDeleteAddressBook = ref(false)
const showAddContacts = ref(false)
const showRemoveContacts = ref(false)
const addressBook = useQuery(api.mail.addressBooks.get, () => ({
  account: accountId,
  id: addressBookName,
}))
const updateBook = useMutation(api.mail.addressBooks.update)
async function saveGeneral(value: { name: string; description: string; isDefault: boolean }) {
  await updateBook.run({
    account: accountId,
    id: addressBookName,
    changes: {
      _name: value.name,
      description: value.description,
      default: value.isDefault,
    },
  })
  raiseToast(__('Address book updated.'))
}
const search = ref('')
const debouncedSearch = refDebounced(search, 300)
const contacts = useInfiniteQuery(api.mail.contacts.list, () => ({
  account: accountId,
  filter: {
    inAddressBook: addressBookName,
    text: debouncedSearch.value,
  },
  start: 0,
  limit: 50,
}))
const rows = computed(() => contacts.rows.map(contactRow))
const totalContacts = useQuery(api.mail.addressBooks.contactCount, () => ({
  account: accountId,
  address_book: addressBookName,
}))
function loadMoreContacts(event: Event) {
  const target = event.target
  if (
    target instanceof HTMLElement &&
    target.scrollTop + target.clientHeight >= target.scrollHeight - 10
  )
    void contacts.fetchNext().catch(() => {})
}
const addressBookDisplay = computed(() => addressBook.data?._name || addressBookName)
usePageMeta(() => appPageMeta(addressBookDisplay.value, 'People'))
const breadcrumbs = computed(() => [
  {
    label: __('Address Books'),
    route: '/mail/address-books',
  },
  {
    label: addressBookDisplay.value,
  },
])
const deleteBook = useMutation(api.mail.addressBooks.delete)
async function deleteAddressBook() {
  await deleteBook.run({
    account: accountId,
    ids: [addressBookName],
  })
  showDeleteAddressBook.value = false
  raiseToast(__('Address book deleted.'))
  await router.push({
    name: 'people-address-books',
    params: {
      accountId,
    },
  })
}
const listView = useTemplateRef('listView')
const addToBook = useMutation(api.mail.contacts.addToBook)
const removeFromBook = useMutation(api.mail.contacts.removeFromBook)
async function addContacts(ids: string[]) {
  await addToBook.run({
    account: accountId,
    ids,
    address_book_id: addressBookName,
  })
  raiseToast(__('Contacts added.'))
}
async function removeContacts() {
  await removeFromBook.run({
    account: accountId,
    ids: Array.from(listView.value?.selections ?? [], String),
    address_book_id: addressBookName,
  })
  showRemoveContacts.value = false
  listView.value?.toggleAllRows()
  raiseToast(__('Contacts removed.'))
}
const deleteAddressBookOptions = computed(() => ({
  title: __('Delete Address Book'),
  message: __('Are you sure you want to delete {0}?', [addressBook.data?._name]),
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      onClick: deleteAddressBook,
    },
  ],
}))
const removeContactsOptions = computed(() => ({
  title: __('Remove Contacts'),
  message: __('Are you sure you want to remove the selected contacts?'),
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      onClick: removeContacts,
    },
  ],
}))
const dropdownOptions = computed(() => [
  {
    label: __('Set as Default'),
    icon: Pin,
    onClick: () =>
      updateBook.run({
        account: accountId,
        id: addressBookName,
        changes: { default: true },
      }),
    condition: () => !addressBook.data?.default,
  },
  {
    label: __('Delete'),
    icon: Trash2,
    onClick: () => (showDeleteAddressBook.value = true),
  },
])
const LIST_COLUMNS = [
  {
    label: __('Name'),
    key: 'full_name',
  },
  {
    label: __('Kind'),
    key: 'kind',
  },
  {
    label: __('Email'),
    key: 'email',
  },
]
const LIST_OPTIONS = {
  showTooltip: false,
  emptyState: {
    description: __('No contacts found.'),
  },
  getRowRoute: (row: { id: string }) => ({
    name: 'people-contact',
    params: {
      accountId,
      contactName: row.id,
    },
  }),
}
</script>
