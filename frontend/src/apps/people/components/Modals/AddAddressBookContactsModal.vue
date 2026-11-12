<template>
  <Dialog v-model:open="show" v-bind="options">
    <template #default>
      <div class="space-y-4">
        <FormControl v-model="search" :placeholder="__('Search...')" />
        <ListView
          v-if="rows"
          ref="listView"
          class="h-60 shrink-0"
          :columns="LIST_COLUMNS"
          :rows="rows"
          :options="LIST_OPTIONS"
          row-key="id"
        >
          <ListHeader />
          <ListRows v-if="rows.length" @scroll="loadMoreContacts" />
          <ListEmptyState v-else />
        </ListView>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { Dialog, FormControl } from 'frappe-ui'
import { ListEmptyState, ListHeader, ListRows, ListView } from 'frappe-ui/experimental'
import { computed, ref, useTemplateRef } from 'vue'

import { api, useInfiniteQuery } from '@/api'
import { contactRow } from '@/apps/people/contactRows'
import { userStore } from '@/apps/people/stores/user'

const store = userStore()
const show = defineModel<boolean>()
const { save } = defineProps<{
  save: (ids: string[]) => Promise<void>
}>()
const listView = useTemplateRef('listView')
const options = computed(() => ({
  title: __('Select Contacts'),
  actions: [
    {
      label: __('Add'),
      variant: 'solid' as const,
      disabled: listView.value?.selections.size === 0,
      onClick: async () => {
        try {
          await save(Array.from(listView.value?.selections ?? [], String))
          show.value = false
        } catch {
          /* Keep selections after refusal. */
        }
      },
    },
  ],
}))
const search = ref('')
const debouncedSearch = refDebounced(search, 300)
const contacts = useInfiniteQuery(api.mail.contacts.list, () => ({
  account: store.accountId,
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
const LIST_COLUMNS = [
  {
    label: __('Name'),
    key: 'full_name',
  },
  {
    label: __('Email'),
    key: 'email',
  },
]
const LIST_OPTIONS = {
  showTooltip: false,
  emptyState: {
    description: __('No contacts to add.'),
  },
}
</script>
