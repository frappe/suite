<template>
  <!-- A phone's search, on the search route itself: the field, and the filters under it as the
       Inbox has its own. What is typed runs as it is typed, into the list below; the Search key
       only puts the keyboard away. The header is every phone screen's 56px, with no line under it,
       and no Back: Search is a tab, and the tab bar under the list leads off it. While typing, the
       keyboard covers the tab bar; putting the keyboard away brings it back. -->
  <div class="shrink-0">
    <div class="flex h-14 items-center gap-2 px-4">
      <!-- Filled and round, as the reply island and the compose page's fields are. -->
      <label
        class="bg-surface-gray-2 flex h-10 min-w-0 flex-1 items-center gap-3 rounded-full pl-3.5 pr-1"
      >
        <Search class="text-ink-gray-5 size-4 shrink-0" />
        <input
          ref="field"
          v-model="text"
          type="search"
          enterkeyhint="search"
          :placeholder="__('Search mail')"
          :aria-label="__('Search mail')"
          class="text-ink-gray-8 placeholder-ink-gray-4 min-w-0 flex-1 border-none bg-transparent p-0 text-lg focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
          @keydown.enter.prevent="commit"
        />
        <button
          v-if="text"
          type="button"
          :aria-label="__('Clear')"
          class="text-ink-gray-5 active:bg-surface-gray-3 flex size-8 shrink-0 items-center justify-center rounded-full"
          @mousedown.prevent
          @click="clearText"
        >
          <X class="size-4" />
        </button>
      </label>
    </div>

    <!-- The Inbox's chips, a size up for a thumb, in one row that scrolls sideways. Folder, From,
         To and Date open a sheet; Unread and Has attachments switch, as the Inbox's do. -->
    <div class="overflow-x-auto px-4 pb-2 pt-1 [scrollbar-width:none]">
      <div class="flex w-max items-center gap-1.5">
        <AdaptiveDropdown :options="folderOptions" :title="__('Folder')">
          <Button v-bind="searchChip(!!query.inMailbox)" :label="folderLabel">
            <template #suffix><ChevronDown class="size-4" /></template>
          </Button>
        </AdaptiveDropdown>
        <!-- Who it is from, and to: the chip says the address picked, cut short to keep the row a row. -->
        <Button
          v-for="person in people"
          :key="person.key"
          v-bind="searchChip(!!query[person.key])"
          class="max-w-56"
          :label="person.label"
          @click="pickPerson(person.key)"
        >
          <template #suffix><ChevronDown class="size-4 shrink-0" /></template>
        </Button>
        <AdaptiveDropdown :options="dateOptions" :title="__('Date')">
          <Button v-bind="searchChip(!!(query.after || query.before))" :label="dateLabel">
            <template #suffix><ChevronDown class="size-4" /></template>
          </Button>
        </AdaptiveDropdown>
        <Button
          v-bind="searchChip(query.isRead === 'false')"
          :label="__('Unread')"
          @click="toggle('isRead', 'false')"
        />
        <Button
          v-bind="searchChip(query.hasAttachment === 'true')"
          :label="__('Has attachments')"
          @click="toggle('hasAttachment', 'true')"
        />
        <!-- Filters a phone has no chip for, set on a desktop and carried here by a recent search
             or a link: said as they are, and a tap takes them off. -->
        <Button
          v-for="extra in extraFilters"
          :key="extra.key"
          v-bind="searchChip(true)"
          :label="extra.label"
          :aria-label="__('Remove {0}', [extra.label])"
          @click="setFilter(extra.key, undefined)"
        >
          <template #suffix><X class="size-3.5" /></template>
        </Button>
      </div>
    </div>
    <!-- How many the search found, its line held by a bar while it looks, so the list does not
         move down when the number comes. -->
    <p v-if="count !== undefined" class="text-ink-gray-5 flex h-6 items-center px-4 text-sm">
      <span v-if="count === null" class="bg-surface-gray-3 h-3 w-20 animate-pulse rounded-4" />
      <template v-else>{{ count }}</template>
    </p>

    <SearchDateRangeSheet
      v-model:open="pickingRange"
      :after="query.after"
      :before="query.before"
      @pick="setDates"
    />
    <SearchPersonSheet
      v-model:open="pickingPerson"
      :side="personField"
      :value="query[personField]"
      @pick="(person) => setFilter(personField, person)"
    />
  </div>
</template>

<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import { Button } from 'frappe-ui'
import { ChevronDown, Search, X } from 'lucide-vue-next'
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import SearchDateRangeSheet from '@/apps/mail/components/mobile/SearchDateRangeSheet.vue'
import SearchPersonSheet from '@/apps/mail/components/mobile/SearchPersonSheet.vue'
import { useRecentMailSearches } from '@/apps/mail/composables/recentMailSearches'
import { userStore } from '@/apps/mail/stores/user'
import type { MailboxData } from '@/apps/mail/types'
import { mailSearchRoute } from '@/apps/mail/utils/composables'
import {
  dateRangeLabel,
  searchChip,
  searchDatePresets,
  searchLabel,
} from '@/apps/mail/utils/phoneSearch'
import { folderIcon } from '@/apps/mail/utils/useThreadActions'
import AdaptiveDropdown from '@/platform/feedback/AdaptiveDropdown.vue'
import { translate as __ } from '@/platform/translation'

/** How many the list under it holds ("12 results"); null while searching, left out when none. */
defineProps<{ count?: string | null }>()

const route = useRoute()
const router = useRouter()
const store = userStore()
const field = useTemplateRef<HTMLInputElement>('field')
const { rememberSearch } = useRecentMailSearches()

// The search as the route holds it, every value a string: what the list below reads.
const query = computed<Record<string, string>>(() =>
  Object.fromEntries(
    Object.entries(route.query).flatMap(([key, value]) => {
      const scalar = Array.isArray(value) ? value[0] : value
      return typeof scalar === 'string' && scalar ? [[key, scalar]] : []
    }),
  ),
)
// In place: a phone's Back leaves the search, not each word and filter on the way to it.
const runSearch = (next: Record<string, string | undefined>) => {
  const kept = Object.fromEntries(
    Object.entries(next).filter((entry): entry is [string, string] => !!entry[1]),
  )
  return router.replace(mailSearchRoute(store.accountId, kept))
}
const setFilter = (key: string, value: string | undefined) =>
  runSearch({ ...query.value, [key]: value })
const toggle = (key: string, value: string) =>
  setFilter(key, query.value[key] === value ? undefined : value)

// --- The field ---

// What is typed, run a moment after typing stops, as the list's own search is.
const text = ref(query.value.text ?? '')
watchDebounced(
  text,
  (typed) => {
    if (typed.trim() !== (query.value.text ?? ''))
      void runSearch({ ...query.value, text: typed.trim() })
  },
  { debounce: 300 },
)
// Changed from elsewhere (a recent search taken up, a filter cleared): the field follows.
watch(
  () => query.value.text ?? '',
  (asked) => {
    if (asked !== text.value.trim()) text.value = asked
  },
)
const clearText = () => {
  text.value = ''
  void runSearch({ ...query.value, text: undefined })
  field.value?.focus()
}
// The Search key: the search is what is on screen, and the keyboard goes so the results can be seen.
const commit = () => {
  field.value?.blur()
  remember()
}
const remember = () =>
  rememberSearch({
    text: query.value.text ?? '',
    filters: Object.fromEntries(
      Object.entries(query.value).filter(([key]) => !['text', 'all_accounts'].includes(key)),
    ),
    label: searchLabel(query.value, folderName),
    account: store.accountId,
  })
defineExpose({ remember })

// --- The chips ---

const folderName = (id: string) =>
  store.mailboxes.data?.find((mailbox: MailboxData) => mailbox.id === id)?._name ?? id
const folderLabel = computed(() =>
  query.value.inMailbox ? folderName(query.value.inMailbox) : __('Folder'),
)
const folderOptions = computed(() => [
  {
    label: __('Any folder'),
    icon: 'lucide-folders',
    selected: !query.value.inMailbox,
    onClick: () => setFilter('inMailbox', undefined),
  },
  ...(store.mailboxes.data ?? []).map((mailbox: MailboxData) => ({
    label: mailbox._name,
    icon: folderIcon(mailbox),
    selected: query.value.inMailbox === mailbox.id,
    onClick: () => setFilter('inMailbox', mailbox.id),
  })),
])

const presets = computed(() => searchDatePresets())
const preset = computed(() =>
  query.value.after ? undefined : presets.value.find((p) => p.before === query.value.before),
)
const hasDates = computed(() => !!(query.value.after || query.value.before))
const dateLabel = computed(() =>
  !hasDates.value ? __('Date') : (preset.value?.label ?? dateRangeLabel(query.value)),
)
const setDates = (dates: { after?: string; before?: string }) =>
  runSearch({ ...query.value, after: dates.after, before: dates.before })
const pickingRange = ref(false)
const dateOptions = computed(() => [
  { label: __('Any time'), selected: !hasDates.value, onClick: () => setDates({}) },
  ...presets.value.map((option) => ({
    label: option.label,
    selected: preset.value === option,
    onClick: () => setDates({ before: option.before }),
  })),
  {
    label: __('Custom range'),
    selected: hasDates.value && !preset.value,
    onClick: () => (pickingRange.value = true),
  },
])

// The field is kept after the sheet closes, so its title holds while it slides away.
const personField = ref<'from' | 'to'>('from')
const pickingPerson = ref(false)
const pickPerson = (field: 'from' | 'to') => {
  personField.value = field
  pickingPerson.value = true
}
const people = computed(() => [
  {
    key: 'from' as const,
    label: query.value.from ? __('From {0}', [query.value.from]) : __('From'),
  },
  { key: 'to' as const, label: query.value.to ? __('To {0}', [query.value.to]) : __('To') },
])

// The ones the chips above do not stand for.
const EXTRA_LABELS = [
  ['cc', __('cc')],
  ['bcc', __('bcc')],
  ['with', __('with')],
  ['subject', __('subject')],
] as const
const extraFilters = computed(() =>
  EXTRA_LABELS.flatMap(([key, word]) =>
    query.value[key] ? [{ key, label: `${word}: ${query.value[key]}` }] : [],
  ),
)
</script>
