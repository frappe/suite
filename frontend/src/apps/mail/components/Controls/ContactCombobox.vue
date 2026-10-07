<template>
  <Combobox
    v-model="model"
    v-model:open="showSuggestions"
    :label="label"
    :options="options"
    placeholder=""
    :open-on-click="false"
    @update:query="search"
  >
    <template #item-prefix="{ item, query }">
      <Avatar :image="item.image" :label="item.label || query" size="sm" />
    </template>
    <template #item-label="{ item }">
      <ContactOption
        :contact="{
          email: typeof item.value === 'string' ? item.value : '',
          display_name: item.label,
        }"
      />
    </template>
    <template #item-create="{ query }"> {{ query }} </template>
  </Combobox>
</template>

<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { Avatar, Combobox } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useQuery } from '@/api'
import ContactOption from '@/apps/mail/components/Controls/ContactOption.vue'
import { userStore } from '@/apps/mail/stores/user'

// Self-contained contact-autocomplete combobox: searches contacts as you type (Avatar + name over email)
// and offers a "use what you typed" create row for a value that isn't a contact.
//
// `account` is whose address book to look in. It defaults to the mail account in view, which is
// what every caller inside mail wants; a caller from another app — the calendar's search filters,
// say — passes its own, since the two apps number their accounts separately. The mail store is
// only reached for when the default is the one in use: outside mail there may be none to reach.
const props = defineProps<{ label: string; account?: string }>()
const model = defineModel<string>()

let mailUser: ReturnType<typeof userStore> | undefined
const searchAccount = () => props.account ?? (mailUser ??= userStore()).accountId

const searchText = ref('')
const debouncedSearch = refDebounced(searchText, 300)
const showSuggestions = ref(false)
const contactSearch = useQuery(api.mail.contacts.suggest, () =>
  debouncedSearch.value ? { account: searchAccount(), text: debouncedSearch.value } : false,
)
const contacts = computed(() =>
  (contactSearch.data ?? []).map((contact) => ({
    value: contact.email,
    label: contact.name || contact.email,
    email: contact.email,
    display_name: contact.name || '',
    image: contact.user_image ?? undefined,
  })),
)
function search(text: string) {
  searchText.value = text
  if (!text) showSuggestions.value = false
}

// Suggestions only exist for a typed query — with an empty input the popover
// would show stale results from the previous query (or a bare "No results"
// panel), so block reka's focus/arrow-key opens too, not just hide options.
watch(showSuggestions, (open) => {
  if (open && !searchText.value) showSuggestions.value = false
})

// Contact matches plus a "create" entry (like compose's RecipientInput) so a typed value that isn't a
// contact can still be applied.
const options = computed(() => {
  if (!searchText.value) return []
  return [
    ...contacts.value,
    {
      type: 'custom' as const,
      slot: 'create',
      condition: () => !contacts.value.length,
      onClick: ({ query }: { query: string }) => {
        model.value = query
      },
    },
  ]
})
</script>
