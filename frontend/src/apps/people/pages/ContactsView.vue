<template>
  <DashboardLayout
    area="people"
    :breadcrumbs="[{ label: __('Contacts') }]"
    :button-label="__('Add Contact')"
    :button-action="() => (showAddContact = true)"
  >
    <FormControl v-model="search" :placeholder="__('Search')" class="sm:w-80">
      <template #prefix>
        <FeatherIcon name="search" class="text-ink-gray-5 w-4" />
      </template>
    </FormControl>

    <ListView
      ref="listView"
      class="flex-1"
      :columns="LIST_COLUMNS"
      :rows="rows"
      :options="listOptions"
      row-key="id"
    >
      <ListHeader />
      <ListRows v-if="rows.length" @scroll="loadMoreContacts" />
      <ListEmptyState v-else />
      <ListSelectBanner>
        <template #actions>
          <Button
            variant="ghost"
            theme="red"
            :label="__('Delete')"
            @click="showDeleteContacts = true"
          />
        </template>
      </ListSelectBanner>
    </ListView>
  </DashboardLayout>

  <AddContactModal v-model="showAddContact" />
  <Dialog v-model:open="showDeleteContacts" v-bind="DELETE_CONTACTS_OPTIONS" />
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
import { computed, ref, useTemplateRef } from 'vue'

import { api, useInfiniteQuery, useMutation } from '@/api'
import AddContactModal from '@/apps/people/components/Modals/AddContactModal.vue'
import { contactRow } from '@/apps/people/contactRows'
import { userStore } from '@/apps/people/stores/user'
import { raiseToast } from '@/apps/people/utils'
import DashboardLayout from '@/components/dashboard/DashboardLayout.vue'
import { appPageMeta } from '@/utils/documentTitle'

const { accountId } = defineProps<{
  accountId: string
}>()
usePageMeta(() => appPageMeta(__('Contacts'), 'People'))
userStore()
const listView = useTemplateRef('listView')
const showAddContact = ref(false)
const showDeleteContacts = ref(false)
const search = ref('')
const debouncedSearch = refDebounced(search, 300)
const contacts = useInfiniteQuery(api.mail.contacts.list, () => ({
  account: accountId,
  filter: {
    text: debouncedSearch.value,
  },
  start: 0,
  limit: 50,
}))
const rows = computed(() => contacts.rows.map(contactRow))
function loadMoreContacts(event: Event) {
  const target = event.target
  if (
    target instanceof HTMLElement &&
    target.scrollTop + target.clientHeight >= target.scrollHeight - 10
  )
    void contacts.fetchNext().catch(() => {})
}
const removeContacts = useMutation(api.mail.contacts.delete)
async function deleteContacts() {
  try {
    await removeContacts.run({
      account: accountId,
      ids: Array.from(listView.value?.selections ?? [], String),
    })
    showDeleteContacts.value = false
    raiseToast(__('Contacts deleted.'))
    listView.value?.toggleAllRows()
  } catch {
    /* Keep selections and the dialog after refusal. */
  }
}
const listOptions = computed(() => ({
  showTooltip: false,
  emptyState: {
    description: contacts.isFetching ? __('Loading...') : __('No contacts found.'),
  },
  getRowRoute: (row: { id: string }) => ({
    name: 'people-contact',
    params: {
      accountId,
      contactName: row.id,
    },
  }),
}))
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
const DELETE_CONTACTS_OPTIONS = {
  title: __('Delete Contacts'),
  message: __('Are you sure you want to delete the selected contacts?'),
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      onClick: deleteContacts,
    },
  ],
}
</script>
