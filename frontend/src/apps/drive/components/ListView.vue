<template>
  <List
    class="relative select-none pt-3 flex flex-col flex-1 min-h-0 list-row-px-5 sm:list-row-px-3"
    :columns="columnTracks"
    :row-height="40"
    divider="inset"
  >
    <!-- Header is inside the scroll container so it shares the rows' width -->
    <div
      ref="scrollContainer"
      class="flex-1 min-h-0 overflow-y-auto px-0 sm:px-2 isolate [scrollbar-gutter:stable]"
    >
      <ListHeader class="group sticky top-0 z-10 bg-surface-base">
        <ListHeaderCell>
          <Checkbox
            class="shrink-0"
            :class="selectAllState.some ? '' : 'invisible group-hover:visible'"
            :model-value="selectAllState.all"
            :indeterminate="selectAllState.some && !selectAllState.all"
            :aria-label="__('Select all visible items')"
            @click.stop="toggleSelectAll"
          />
        </ListHeaderCell>
        <ListHeaderCellSort :direction="directionFor('file_name')" @click="toggleSort('file_name', __('Name'))">
          {{ __('Name') }}
          <template #suffix="{ direction }">
            <span class="block size-3.5" :class="sortIcon(direction)" />
          </template>
        </ListHeaderCellSort>
        <ListHeaderCellSort class="hidden sm:flex" :direction="directionFor('owner')" @click="toggleSort('owner', __('Owner'))">
          {{ __('Owner') }}
          <template #suffix="{ direction }">
            <span class="block size-3.5" :class="sortIcon(direction)" />
          </template>
        </ListHeaderCellSort>
        <ListHeaderCellSort :direction="directionFor('modified')" @click="toggleSort('modified', __('Last Modified'), false)">
          {{ __('Last Modified') }}
          <template #suffix="{ direction }">
            <span class="block size-3.5" :class="sortIcon(direction)" />
          </template>
        </ListHeaderCellSort>
        <ListHeaderCellSort class="hidden sm:flex" :direction="directionFor('file_size')" @click="toggleSort('file_size', __('Size'))">
          {{ __('Size') }}
          <template #suffix="{ direction }">
            <span class="block size-3.5" :class="sortIcon(direction)" />
          </template>
        </ListHeaderCellSort>
        <ListHeaderCell />
      </ListHeader>
      <template v-if="folderContents">
        <NoFilesSection v-if="!formattedRows.length" description="Nothing found - try something else?" />
        <template v-else-if="formattedRows[0]?.group">
          <ListGroup v-for="group in formattedRows" :key="group.group" :label="group.group" class="mt-3 first:mt-0">
            <DriveListRow
              :items="flattenRows(group.rows)"
              :context-menu="contextMenu"
              :selections
              :toggle-selection="toggleSelection"
              :toggle-folder="toggleFolderRow"
              :root-entity="rootEntity"
              @dropped="emit('dropped')"
            />
          </ListGroup>
        </template>
        <div v-else>
          <DriveListRow
            :items="visibleItems"
            :context-menu="contextMenu"
            :selections
            :toggle-selection="toggleSelection"
            :toggle-folder="toggleFolderRow"
            :root-entity="rootEntity"
            @dropped="(...p) => $emit('dropped', ...p)"
          />
        </div>
        <ListRow v-if="loadingMore" class="pointer-events-none">
          <ListCell />
          <ListCell>
            <div class="h-[16px] w-[16px] shrink-0 mr-2">
              <Skeleton class="h-[16px] w-[16px] rounded-sm" />
            </div>
            <Skeleton class="h-3.5 w-40 rounded" />
          </ListCell>
          <ListCell class="hidden sm:flex">
            <Skeleton class="size-5 shrink-0 mr-2 rounded-full" />
            <Skeleton class="h-3 w-16 rounded" />
          </ListCell>
          <ListCell><Skeleton class="h-3 w-20 rounded" /></ListCell>
          <ListCell class="hidden sm:flex"><Skeleton class="h-3 w-12 rounded" /></ListCell>
          <ListCell />
        </ListRow>
      </template>
    </div>
  </List>
  <ContextMenu v-if="rowEvent && selectedRow" :key="selectedRow.name" v-on-outside-click="() => (rowEvent = false)"
    :close="() => (rowEvent = false)" :action-items="dropdownActionItems(selectedRow)" :event="rowEvent" />
</template>
<script setup>
import { List, ListHeader, ListHeaderCell, ListHeaderCellSort, ListGroup, ListRow, ListCell } from 'frappe-ui/list'
import { Checkbox, Skeleton, onOutsideClickDirective as vOnOutsideClick } from 'frappe-ui'
import { activeEntity, setActiveEntity } from '@/apps/drive/data/selection'
import { computed, ref, watch } from 'vue'
import ContextMenu from '@/apps/drive/components/ContextMenu.vue'
import DriveListRow from './DriveListRow.vue'
import NoFilesSection from './NoFilesSection.vue'
import { openEntity, isModKey } from '@/apps/drive/utils/files'
import {
  flattenRows,
  toggleFolder,
  refreshExpanded,
} from '@/apps/drive/data/folderTree'
import { useListColumns } from '@/apps/drive/data/listColumns'


const props = defineProps({
  folderContents: Object,
  actionItems: Array,
  rootEntity: Object,
  loadingMore: Boolean,
})
const emit = defineEmits(['dropped'])

const selections = defineModel(new Set())
const sortOrder = defineModel('sortOrder')
const selectedRow = ref(null)

const rowEvent = ref(null)

const scrollContainer = ref(null)

// Sort state lives on `sortOrder` (shared with the toolbar's sort control on
// grid view); clicking a header toggles direction on repeat-click of the same
// field, or switches field with a sensible default direction.
function directionFor(field) {
  return sortOrder.value.field === field
    ? sortOrder.value.ascending
      ? 'asc'
      : 'desc'
    : null
}
function toggleSort(field, label, firstAscending = true) {
  if (sortOrder.value.field === field) {
    sortOrder.value.ascending = !sortOrder.value.ascending
  } else {
    sortOrder.value.field = field
    sortOrder.value.label = label
    sortOrder.value.ascending = firstAscending
  }
}
function sortIcon(direction) {
  if (!direction) return 'lucide-arrow-up-down'
  return direction === 'asc' ? 'lucide-arrow-up' : 'lucide-arrow-down'
}

const formattedRows = computed(() => {
  if (!props.folderContents) return []
  if (Array.isArray(props.folderContents)) return props.folderContents
  return Object.keys(props.folderContents)
    .map((k) => ({
      group: k,
      rows: props.folderContents[k] || [],
      collapsed: false,
    }))
    .filter((g) => g.rows.length)
})

const columnTracks = useListColumns()

const visibleItems = computed(() => flattenRows(formattedRows.value))
// Collapsing hides rows that may be selected — drop them from the selection so
// the toolbar can't act on rows nobody can see.
const toggleFolderRow = (row) => {
  const collapsed = toggleFolder(row, sortOrder.value)
  if (!collapsed.length) return
  const next = new Set(selections.value)
  collapsed.forEach((name) => next.delete(name))
  selections.value = next
}
watch(sortOrder, () => refreshExpanded(sortOrder.value), { deep: true })

// Shift-click range select: extends from the last row clicked (whichever
// way — checkbox or plain click) through the clicked row, in on-screen
// order. `flatRows` collapses grouped views and expanded subtrees into one
// sequence so a range can span those boundaries.
const lastSelectedName = ref(null)
const flatRows = computed(() =>
  (formattedRows.value[0]?.group
    ? formattedRows.value.flatMap((g) => flattenRows(g.rows))
    : visibleItems.value
  )
    .filter((i) => i.row)
    .map((i) => i.row)
)
const visibleNames = computed(() => flatRows.value.map(({ name }) => name))
defineExpose({ scrollEl: scrollContainer, visibleNames })
function toggleSelection(row, event) {
  if (event?.shiftKey && lastSelectedName.value) {
    const names = flatRows.value.map((r) => r.name)
    const from = names.indexOf(lastSelectedName.value)
    const to = names.indexOf(row.name)
    if (from !== -1 && to !== -1) {
      const [start, end] = from < to ? [from, to] : [to, from]
      const next = new Set(selections.value)
      names.slice(start, end + 1).forEach((n) => next.add(n))
      selections.value = next
      return
    }
  }
  const next = new Set(selections.value)
  if (next.has(row.name)) next.delete(row.name)
  else next.add(row.name)
  selections.value = next
  lastSelectedName.value = row.name
}

const selectAllState = computed(() => {
  const names = flatRows.value.map(({ name }) => name)
  const count = names.filter((name) => selections.value.has(name)).length
  return { all: names.length > 0 && count === names.length, some: count > 0 }
})

function toggleSelectAll() {
  const names = flatRows.value.map(({ name }) => name)
  const next = new Set(selections.value)
  if (selectAllState.value.all) names.forEach((name) => next.delete(name))
  else names.forEach((name) => next.add(name))
  selections.value = next
}

const setActive = (entityName) => {
  const entity = props.folderContents.find((k) => k.name === entityName)
  selectedRow.value =
    !entity || entity.name !== activeEntity.value?.name ? entity : null
}

watch(selectedRow, (k) => {
  setActiveEntity(k)
})
const dropdownActionItems = (row) => {
  if (!row) return []
  return props.actionItems
    .filter((a) => !a.isEnabled || a.isEnabled(row))
    .map((a) => ({
      ...a,
      handler: () => {
        rowEvent.value = false
        setActiveEntity(row)
        a.action([row])
      },
    }))
}

const contextMenu = (event, row) => {
  if (selections.value.size > 0) return
  // Ctrl + click triggers context menu on Mac
  if (isModKey(event)) openEntity(row, true)
  rowEvent.value = event
  selectedRow.value = row
  event.stopPropagation()
  event.preventDefault()
}

</script>
<style>
/* Keep the header divider aligned with the inset row dividers. */
[data-slot='list-header-border'] {
  grid-column: 2 / -1;
}
</style>
