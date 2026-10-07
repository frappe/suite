<template>
  <Dialog v-model:open="show" v-bind="options">
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="selectFrom"
          :label="__('Select From')"
          type="combobox"
          :open-on-click="true"
          :options="selectFromOptions"
        />
        <hr />
        <FormControl v-model="search" :placeholder="__('Search...')" />
        <ListView
          v-if="rows"
          ref="listView"
          class="h-60 shrink-0"
          :columns="LIST_COLUMNS"
          :rows="rows"
          :options="LIST_OPTIONS"
          row-key="email"
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

import { api, useInfiniteQuery, type InputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import { extractNameFromEmail } from '@/apps/mail/utils'

const show = defineModel<boolean>()

const emit = defineEmits(['insert'])

// Read store.accountId live in makeParams; destructuring would snapshot the
// unwrapped value and miss account switches while this modal stays mounted.
const store = userStore()
const { addressBooks } = store

const listView = useTemplateRef('listView')

const options = computed(() => ({
  title: __('Select Contacts'),
  actions: [
    {
      label: __('Insert'),
      variant: 'solid' as const,
      disabled: listView.value?.selections.size === 0,
      onClick: () => {
        emit('insert', Array.from(listView.value?.selections))
        show.value = false
      },
    },
  ],
}))

const selectFrom = ref('all')
const selectFromOptions = computed(() => [
  { label: __('All Contacts'), value: 'all' },
  ...(addressBooks.data ?? []).map((ab) => ({
    label: ab._name,
    value: ab.id,
  })),
])

const search = ref('')
const debouncedSearch = refDebounced(search, 300)

const contacts = useInfiniteQuery(api.mail.contacts.list, () => {
  const filters: NonNullable<InputOf<typeof api.mail.contacts.list>['filter']>[] = []
  if (debouncedSearch.value)
    filters.push({
      operator: 'OR',
      conditions: [{ text: debouncedSearch.value }, { email: debouncedSearch.value }],
    })
  if (selectFrom.value !== 'all') filters.push({ inAddressBook: selectFrom.value })
  return {
    account: store.accountId,
    filter: filters.length > 1 ? { operator: 'AND', conditions: filters } : (filters[0] ?? null),
    start: 0,
    limit: 50,
  }
})
const rows = computed(() =>
  contacts.rows.flatMap((card) =>
    card.emails
      .filter((email) => email.address)
      .map((email) => ({
        email: email.address!,
        full_name: card.full_name || extractNameFromEmail(email.address!),
        user_image: null,
      })),
  ),
)
function loadMoreContacts(event: Event) {
  const target = event.target
  if (
    target instanceof HTMLElement &&
    target.scrollTop + target.clientHeight >= target.scrollHeight - 10
  )
    void contacts.fetchNext().catch(() => {})
}

const LIST_COLUMNS = [
  { label: __('Name'), key: 'full_name' },
  { label: __('Email'), key: 'email' },
]

const LIST_OPTIONS = { showTooltip: false, emptyState: { description: __('No contacts.') } }
</script>
