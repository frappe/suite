<template>
  <Dialog v-model:open="show" size="xl" position="top" bare class="z-11">
    <template #default>
      <div class="flex flex-col">
        <div class="relative">
          <div class="p-1.5">
            <TextInput
              variant="ghost"
              v-model="searching"
              type="text"
              placeholder="Search through documents..."
              @keydown="
                (e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    query = searching
                  }
                }
              "
              autocomplete="off"
            >
              <template #prefix><LucideSearch class="size-4 text-ink-gray-6" /></template>
              <template #suffix v-if="searching">
                <span class="text-ink-gray-5 text-xs flex items-center gap-1"
                  ><KeyboardShortcut combo="Enter" /> to search</span
                >
              </template>
            </TextInput>
          </div>
          <div
            ref="scrollContainerRef"
            v-if="query"
            class="max-h-96 overflow-auto border-t border-outline-gray-1 dark:border-outline-gray-2 p-2.5"
          >
            <LoadingIndicator v-if="search.loading" class="size-5 my-10 mx-auto" />
            <div v-else-if="searchResults.length" class="space-y-1">
              <div class="text-sm text-ink-gray-5 ps-3">
                Showing results for "<span class="font-medium">{{ query }}</span
                >":
              </div>
              <div v-for="doc in searchResults" :key="doc.name">
                <div
                  class="flex cursor-pointer items-center gap-3 rounded px-3 py-2.5 transition-colors hover:bg-surface-gray-3"
                >
                  <div class="min-w-0 flex-1 flex flex-col gap-2">
                    <div class="truncate text-base-medium text-ink-gray-7">
                      {{ doc.title }}
                    </div>
                    <div
                      class="line-clamp-3 text-sm text-ink-gray-5"
                      v-html="doc.content.replace('\n', '<enter>')"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div
              v-else-if="query"
              class="px-4.5 py-5 text-center flex flex-col gap-2 text-ink-gray-5"
            >
              <LucideFileText class="mx-auto size-5" />
              <p class="text-sm">There doesn't seem to be anything with "{{ query }}".</p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Dialog, TextInput, debounce } from 'frappe-ui'
import { search } from '@/apps/writer/resources'

import LucideSearch from '~icons/lucide/search'
import LucideFileText from '~icons/lucide/file-text'

import { LoadingIndicator, KeyboardShortcut } from 'frappe-ui'

const show = defineModel<boolean>()

const searching = ref('')
const query = ref('')
const searchResults = computed(() => {
  return search.data?.results ? search.data.results : []
})
watch(query, (v) => (v ? search.fetch({ query: v }) : (search.data.results = [])))
const setDebouncedQuery = debounce(() => (query.value = searching.value), 500)
watch(searching, (v) => (v ? setDebouncedQuery() : (query.value = '')))
</script>
<style>
mark {
  background-color: var(--surface-amber-2);
  border-radius: 3px;
  padding: 0 2px;
  color: var(--text-ink-gray-5);
}
</style>
