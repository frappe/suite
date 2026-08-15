<template>
  <div
    ref="container"
    class="mx-auto w-96 sm:w-[60%] pt-8 h-screen space pb-64"
  >
    <List
      v-if="thumbnail === 'list'"
      :columns="columnTracks"
      :row-height="40"
      divider="inset"
      class="list-row-px-3 max-sm:[--list-columns:auto_minmax(0,1fr)_auto]"
    >
      <ListGroup
        v-for="([group, files], i) in visibleGroups"
        :key="group"
        :label="group"
        sticky
        class="mt-3 first:mt-0"
      >
        <template #header>
          <span class="flex-1">{{ group }}</span>
          <TabButtons
            v-if="i === 0"
            v-model="thumbnail"
            class="w-fit"
            :options="viewOptions"
          />
        </template>
        <ListRow
          v-for="row in files"
          :key="row.name"
          :to="{ name: 'writer-document', params: { id: row.name } }"
          :data-testid="`writer-document-${row.name}`"
        >
          <ListCell>
            <LucideFileText class="size-4 text-ink-gray-5" />
          </ListCell>
          <ListCell>
            <p class="text-base-medium text-ink-gray-8 truncate">
              {{ row.file_name }}
            </p>
          </ListCell>
          <ListCell class="justify-end gap-2 max-sm:hidden text-xs text-ink-gray-5">
            <LucideGlobe2
              v-if="row.share_count == -2"
              class="size-4 text-ink-gray-6"
            />
            <LucideBuilding2
              v-else-if="row.share_count == -1"
              class="size-4 text-ink-gray-6"
            />
            <LucideUsers
              v-else-if="row.share_count > 0"
              class="size-4 text-ink-gray-6"
            />
            <template v-if="row.owner === currentUserId">
              <Avatar
                :image="$user(row.owner)?.user_image"
                :label="$user(row.owner)?.full_name || 'Deleted'"
                size="xs"
              />
              <span :title="row.owner">
                {{ $user(row.owner)?.full_name || 'Deleted' }}
              </span>
            </template>
          </ListCell>
          <ListCell class="justify-end text-xs text-ink-gray-5">
            <span :title="row.recentDate">{{ row.relativeModified }}</span>
          </ListCell>
        </ListRow>
      </ListGroup>
    </List>

    <template v-else>
      <div
        v-for="([group, files], i) in visibleGroups"
        :key="group"
        class="mt-3 first:mt-0"
      >
        <!-- Mirrors ListGroup's header box exactly (h-8, text-sm-medium,
             sticky) so toggling grid/list moves nothing. `px-3` stands in for
             the `--list-row-padding-x` that list-group-header inherits from
             the List's `list-row-px-3`. -->
        <div
          class="flex h-8 items-center text-sm-medium text-ink-gray-5 sticky top-0 z-10 bg-surface-base px-3"
        >
          <span class="flex-1">{{ group }}</span>
          <TabButtons
            v-if="i === 0"
            v-model="thumbnail"
            class="w-fit"
            :options="viewOptions"
          />
        </div>
        <div
          class="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 lg:grid-cols-5 !mb-0 px-3"
        >
          <section
            v-for="row in files"
            :key="row.name"
            class="group"
            :data-testid="`writer-document-${row.name}`"
            @click="
              $router.push({ name: 'writer-document', params: { id: row.name } })
            "
          >
            <div
              class="aspect-[37/50] cursor-pointer overflow-hidden rounded-md dark:bg-gray-900 border border-gray-50 dark:border-outline-gray-1 px-2.5 py-1 shadow-lg transition-shadow hover:shadow-xl"
            >
              <div class="overflow-hidden text-ellipsis whitespace-nowrap">
                <div
                  class="prose prose-sm prose-v3 pointer-events-none w-[200%] origin-top-left scale-[.55] prose-p:my-1 md:w-[250%] md:scale-[.39]"
                  v-html="row.html"
                />
              </div>
            </div>
            <div class="mt-3 flex justify-between items-center">
              <div class="flex-grow w-full min-w-0">
                <h1 class="text-base-medium truncate text-ink-gray-7">
                  {{ row.file_name }}
                </h1>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>

    <div
      v-if="props.resource.data?.length === 0"
      class="flex flex-col items-center gap-2.5 my-10"
    >
      <div class="flex flex-col gap-1.5 items-center">
        <LucideFileText class="size-8 text-ink-gray-4" />
        <p class="text-base-medium text-ink-gray-6">
          {{ __('No documents yet.') }}
        </p>
      </div>
      <p class="text-sm text-ink-gray-5">
        {{ __('Create a document to get started.') }}
      </p>
    </div>
  </div>
  <!-- <ContextMenu
      v-if="rowEvent && selectedRow"
      :key="selectedRow.name"
      :action-items="dropdownActionItems(selectedRow)"
      :event="rowEvent"
      :close="() => (rowEvent = false)"
    /> -->
</template>

<script setup lang="ts">
import { computed, ref, watch, useTemplateRef } from 'vue'

import { Avatar, TabButtons } from 'frappe-ui'
import { List, ListCell, ListGroup, ListRow } from 'frappe-ui/list'
import { useInfiniteScroll } from '@vueuse/core'
import LucideGrid from '~icons/lucide/grid'
import LucideList from '~icons/lucide/list'
import LucideGlobe2 from '~icons/lucide/globe-2'
import LucideBuilding2 from '~icons/lucide/building-2'
import LucideUsers from '~icons/lucide/users'
import LucideFileText from '~icons/lucide/file-text'
import { useSessionStore } from '@/boot/session'
import { useUsers } from '@/apps/writer/composables/useUsers'

const currentUserId = computed(() => useSessionStore().user)
const { getUser: $user } = useUsers()

const thumbnail = ref(
  JSON.parse(localStorage.getItem('writer-view') || '"list"'),
)
watch(thumbnail, (v) => localStorage.setItem('writer-view', JSON.stringify(v)))
const props = defineProps({
  groups: Object,
  resource: Object,
  actionItems: Array,
})

const viewOptions = [
  { label: 'Grid', value: 'grid', icon: LucideGrid, hideLabel: true },
  { label: 'List', value: 'list', icon: LucideList, hideLabel: true },
]

// icon | title | owner meta (hidden on mobile) | relative date.
// The leading track matters: `divider="inset"` spans `2 / -1`, so dividers
// start at the title rather than under the icon.
const columnTracks = ['auto', 'minmax(0,1fr)', 'auto', '7rem']

const visibleGroups = computed(() =>
  Object.entries(props.groups).filter(([, files]) => files.length),
)

const container = useTemplateRef<HTMLElement>('container')
useInfiniteScroll(
  container,
  () => {
    if (props.resource.hasNextPage && !props.resource.loading) {
      props.resource.next()
    }
  },
  {
    distance: 10,
    canLoadMore: () => {
      return props.resource.hasNextPage
    },
  },
)
</script>
