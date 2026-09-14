<template>
  <div ref="listing" @keydown="onKeydown">
    <template v-if="query.status === 'pending' && !query.rows.length">
      <div class="space-y-2 pt-3" aria-label="Loading files">
        <Skeleton v-for="index in 8" :key="index" class="h-10 w-full" />
      </div>
    </template>
    <div v-else-if="query.error && !query.rows.length" class="flex flex-col items-center gap-3 py-16">
      <ErrorMessage :message="query.error?.message" />
      <Button label="Retry" @click="query.refetch()" />
    </div>
    <div v-else-if="!query.rows.length" class="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <span class="lucide-folder-open size-6 text-ink-gray-4" aria-hidden="true" />
      <p class="text-base text-ink-gray-7">{{ emptyTitle }}</p>
      <p class="text-p-sm text-ink-gray-5">{{ emptyDescription }}</p>
    </div>

    <template v-else-if="presentation.view === 'list'">
      <List
        :columns="columnTracks"
        :row-height="48"
        :selectable="false"
        :selection="selection"
        class="mt-3 list-row-px-3"
        @update:selection="$emit('update:selection', $event)"
      >
        <ListHeader>
          <ListHeaderCellSort :direction="directionFor('title')" @click="$emit('sort', 'title')">Name</ListHeaderCellSort>
          <ListHeaderCellSort v-if="hasColumn('kind')" :direction="directionFor('kind')" @click="$emit('sort', 'kind')">Type</ListHeaderCellSort>
          <ListHeaderCellSort v-if="hasColumn('owner')" :direction="directionFor('owner')" @click="$emit('sort', 'owner')">Owner</ListHeaderCellSort>
          <ListHeaderCellSort v-if="hasColumn('size')" align="end" :direction="directionFor('size')" @click="$emit('sort', 'size')">Size</ListHeaderCellSort>
          <ListHeaderCellSort v-if="hasColumn('modified')" align="end" :direction="directionFor('modified')" @click="$emit('sort', 'modified')">Modified</ListHeaderCellSort>
          <ListHeaderCell><span class="sr-only">Actions</span></ListHeaderCell>
        </ListHeader>
        <ListGroup v-for="section in sections" :key="section.heading || 'all'" :label="section.heading || undefined">
          <ListRow
            v-for="row in section.rows"
            :key="row.name"
            :value="row.name"
            tabindex="0"
            :data-node="row.name"
            @click="onRowClick($event, row)"
            @dblclick="$emit('open', row)"
            @contextmenu.prevent="$emit('menu', row)"
          >
            <ListCell>
              <Checkbox
                :model-value="selection.includes(row.name)"
                :aria-label="`Select ${row.title}`"
                class="mr-2 shrink-0"
                @click.stop
                @update:model-value="$emit('select', row, false)"
              />
              <span class="mr-2 size-4 shrink-0 text-ink-gray-5" :class="nodeIcon(row)" aria-hidden="true" />
              <span class="min-w-0 truncate text-base text-ink-gray-8">{{ row.title }}</span>
              <span v-if="row.favourite" class="lucide-star ml-1.5 size-3.5 text-ink-amber-6" aria-hidden="true" />
              <span v-if="showBreadcrumbs" class="ml-2 truncate text-p-sm text-ink-gray-5">{{ breadcrumbText(row) }}</span>
            </ListCell>
            <ListCell v-if="hasColumn('kind')"><span class="truncate text-base text-ink-gray-7">{{ nodeTypeLabel(row) }}</span></ListCell>
            <ListCell v-if="hasColumn('owner')"><span class="truncate text-base text-ink-gray-7">{{ row.owner }}</span></ListCell>
            <ListCell v-if="hasColumn('size')" class="justify-end"><span class="text-p-sm text-ink-gray-5">{{ formatBytes(row.size) }}</span></ListCell>
            <ListCell v-if="hasColumn('modified')" class="justify-end"><span class="text-p-sm text-ink-gray-5">{{ formatModified(row.modified) }}</span></ListCell>
            <ListCell class="justify-end">
              <Dropdown :options="menuOptions(row)" align="end">
                <Button icon="lucide-ellipsis" variant="ghost" :aria-label="`Actions for ${row.title}`" @click.stop />
              </Dropdown>
            </ListCell>
          </ListRow>
        </ListGroup>
      </List>
    </template>

    <template v-else>
      <section v-for="section in sections" :key="section.heading || 'all'" class="pt-5 first:pt-3">
        <h2 v-if="section.heading" class="px-1 pb-2 text-base text-ink-gray-5">{{ section.heading }}</h2>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3" role="list">
          <div
            v-for="row in section.rows"
            :key="row.name"
            role="listitem"
            class="relative min-h-36 select-none rounded-5 border border-outline-gray-1 hover:bg-surface-gray-1"
            :class="selection.includes(row.name) ? 'bg-surface-gray-2' : 'bg-surface-elevation-1'"
          >
            <Button
              variant="ghost"
              class="flex min-h-36 w-full flex-col p-3 text-start focus-visible:outline focus-visible:outline-2"
              @click="onRowClick($event, row)"
              @dblclick="$emit('open', row)"
              @pointerdown="startLongPress(row)"
              @pointerup="cancelLongPress"
              @pointercancel="cancelLongPress"
            >
              <img v-if="row.preview?.url && !failedPreviews.has(row.name)" :src="row.preview.url" alt="" class="mb-3 h-20 w-full rounded-4 object-cover" @error="previewError(row)" />
              <span v-else class="mb-3 size-5 text-ink-gray-5" :class="nodeIcon(row)" aria-hidden="true" />
              <span class="mt-auto w-full truncate text-base font-medium text-ink-gray-8">{{ row.title }}</span>
              <span class="w-full truncate text-p-sm text-ink-gray-5">{{ row.owner }} · {{ formatModified(row.modified) }}</span>
            </Button>
            <Dropdown :options="menuOptions(row)" align="end">
              <Button class="absolute end-2 top-2" icon="lucide-ellipsis" variant="ghost" :aria-label="`Actions for ${row.title}`" @click.stop />
            </Dropdown>
          </div>
        </div>
      </section>
    </template>

    <Alert v-if="query.error && query.rows.length" class="mt-3" theme="amber" title="Could not refresh files" description="The files already loaded are still shown." />
    <div ref="sentinel" class="flex min-h-12 items-center justify-center py-3">
      <LoadingIndicator v-if="query.isFetchingNext" />
      <Button v-else-if="query.error && query.rows.length" label="Retry loading more" @click="loadMore" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Alert, Button, Checkbox, Dropdown, ErrorMessage, LoadingIndicator, Skeleton } from 'frappe-ui'
import { List, ListCell, ListGroup, ListHeader, ListHeaderCell, ListHeaderCellSort, ListRow } from 'frappe-ui/list'

import type { DriveNode } from '@/apps/drive/client/types'
import { formatBytes, formatModified } from '@/apps/drive/files/internal/format'
import { nodeIcon, nodeTypeLabel } from '@/apps/drive/files/internal/icons'
import type { QueryResult } from '@/platform/server-state'
import { groupContiguous } from './grouping'
import { loadUntilVisible } from './listingWindows'
import type { FilesSort, PresentationState } from './presentation'

const props = defineProps<{
  query: QueryResult<any>
  presentation: PresentationState
  selection: string[]
  selectionMode: boolean
  emptyTitle: string
  emptyDescription: string
  showBreadcrumbs?: boolean
  menuOptions: (node: DriveNode) => any[]
}>()
const emit = defineEmits<{
  'update:selection': [value: string[]]
  sort: [column: FilesSort]
  open: [node: DriveNode]
  select: [node: DriveNode, range: boolean]
  menu: [node: DriveNode]
  'preview-error': [node: DriveNode]
}>()
const listing = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
let longPress: ReturnType<typeof setTimeout> | null = null
const previewRetries = new Set<string>()
const failedPreviews = ref(new Set<string>())

const sections = computed(() => groupContiguous(props.query.rows as DriveNode[], props.presentation.group))
const columnTracks = computed(() => [
  'minmax(12rem,1fr)',
  ...props.presentation.columns.map((column) => column === 'owner' ? '11rem' : column === 'modified' ? '8rem' : '7rem'),
  '2.5rem',
])

onMounted(() => {
  observer = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting) void loadMore()
  }, { rootMargin: '240px' })
  if (sentinel.value) observer.observe(sentinel.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  cancelLongPress()
})

function hasColumn(column: string) {
  return props.presentation.columns.includes(column)
}
function directionFor(column: FilesSort) {
  return props.presentation.sort === column ? props.presentation.dir : null
}
function breadcrumbText(row: DriveNode) {
  return row.breadcrumbs?.map((crumb) => crumb.title).join(' › ') ?? ''
}
function onRowClick(event: MouseEvent, row: DriveNode) {
  if (props.selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) emit('select', row, event.shiftKey)
  else emit('open', row)
}
async function loadMore() {
  if (!props.query.hasNext || props.query.isFetchingNext) return
  await loadUntilVisible({
    get rows() { return props.query.rows },
    get hasNext() { return props.query.hasNext },
    async fetchNext() {
      await props.query.fetchNext()
      return this
    },
  })
}
function startLongPress(row: DriveNode) {
  cancelLongPress()
  longPress = setTimeout(() => emit('select', row, false), 500)
}
function cancelLongPress() {
  if (longPress) clearTimeout(longPress)
  longPress = null
}
function previewError(row: DriveNode) {
  if (!previewRetries.has(row.name)) {
    previewRetries.add(row.name)
    emit('preview-error', row)
    return
  }
  failedPreviews.value = new Set([...failedPreviews.value, row.name])
}
function onKeydown(event: KeyboardEvent) {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-node]')
  const node = (props.query.rows as DriveNode[]).find((row) => row.name === target?.dataset.node)
  if (!node) return
  if (event.key === 'Enter') {
    event.preventDefault()
    emit('open', node)
  }
  if (event.key === ' ') {
    event.preventDefault()
    emit('select', node, event.shiftKey)
  }
}
</script>
