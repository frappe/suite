<template>
  <!-- Mobile mirrors the search overlay's header exactly (same row, same input classes) —
	     searching and results are one page; tapping the readonly input resumes editing. -->
  <div :class="isMobile ? 'border-b' : 'flex flex-col gap-2.5 border-b px-3.5 py-3 sm:px-5'">
    <!-- A flat h-14, the height every mobile header in the product stands at (see
		     MobileTitleHeader), rather than py-2 around the input: the editor's row above is
		     the same 56px, so dismissing it onto this swaps the row rather than resizing it.
		     Sideways too: a 12px gutter, the icon, then gap-2 plus the forms plugin's 12px on
		     the bare input — the calendar search header's measures, and the editor's. -->
    <div v-if="isMobile" class="flex h-14 items-center gap-2 border-b px-3">
      <Search class="text-ink-gray-5 h-4 w-4 shrink-0" />
      <input
        readonly
        :value="searchText"
        :placeholder="__('Search')"
        :aria-label="__('Edit search')"
        class="placeholder-ink-gray-4 w-full cursor-pointer border-none bg-transparent text-base focus:ring-0"
        @mousedown.prevent="openSearch"
      />
    </div>
    <!-- On a desktop the words are edited where they stand, so narrowing a search never hides the
         results it is narrowing. Operators work as they do in the palette, which ⌘K still reopens
         for its suggestions. -->
    <FormControl
      v-else
      v-model="line"
      type="text"
      size="sm"
      class="w-full"
      :class="{ 'max-w-2xl': !showReadingPane }"
      :placeholder="__('Search')"
      :aria-label="__('Search')"
      variant="outline"
      @keydown.enter.prevent="commitLine"
      @keydown.esc.stop.prevent="resetLine($event)"
      @blur="line = searchText"
    >
      <template #prefix>
        <Search class="text-ink-gray-5 size-4" />
      </template>
    </FormControl>
    <SearchFilters :query="query" @update="searchWith" />
    <p v-if="count" class="text-p-sm text-ink-gray-5 px-3.5 pb-2">{{ count }}</p>
  </div>
</template>

<script setup lang="ts">
import { FormControl } from 'frappe-ui'
import { Search } from 'lucide-vue-next'
import { computed, inject, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import SearchFilters from '@/apps/mail/components/SearchFilters.vue'
import { userStore } from '@/apps/mail/stores/user'
import type { UserResource } from '@/apps/mail/types'
import { mailSearchRoute, useScreenSize } from '@/apps/mail/utils/composables'
import {
  hasSearchConditions,
  searchQueryFrom,
  withEditedLine,
  type SearchQuery,
} from '@/apps/mail/utils/searchFilters'
import { useRootStore } from '@/stores/root'

// The search view's own header: the query line and the filters. It owns the whole search-query
// surface — every edit here re-runs the search by pushing a new route, which is what the results
// below already read from.

defineProps<{
  /** How many results there are, where the list's own toolbar isn't there to say. */
  count?: string
}>()

const route = useRoute()
const router = useRouter()
const user = inject<UserResource>('$user')
if (!user) throw new Error('Missing required user provider')
const { isMobile } = useScreenSize()
const store = userStore()
const root = useRootStore()

const showReadingPane = computed(() => !!user.data?.show_reading_pane)

const openSearch = () => (root.paletteOpen = true)

const query = computed(() => searchQueryFrom(route.query))
const searchText = computed(() => query.value.text || '')

const line = ref(searchText.value)
watch(searchText, (text) => (line.value = text))
const resetLine = (event: KeyboardEvent) => {
  line.value = searchText.value
  if (event.target instanceof HTMLElement) event.target.blur()
}
const commitLine = () => searchWith(withEditedLine(query.value, line.value))

// Re-run the search as edited. When nothing is left to search, leave the search view for the Inbox.
const searchWith = (next: SearchQuery) => {
  if (!hasSearchConditions(next)) return exitSearch()
  router.push(mailSearchRoute(store.accountId, next))
}

const exitSearch = () =>
  router.push({
    name: 'mail-mailbox',
    params: { accountId: store.accountId, mailbox: store.mailboxIds.inbox },
  })
</script>
