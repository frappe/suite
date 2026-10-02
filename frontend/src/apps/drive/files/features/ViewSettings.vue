<template>
  <Popover align="end">
    <template #trigger>
      <Button icon="lucide-settings-2" aria-label="View settings" />
    </template>
    <div role="group" aria-label="View settings" class="w-80 max-w-[calc(100vw-20px)] text-ink-gray-8">
      <div class="p-3">
        <TabButtons
          fluid
          size="sm"
          aria-label="View"
          :model-value="presentation.view"
          :options="VIEW_OPTIONS"
          @update:model-value="pickView"
        />
      </div>
      <div v-if="arrangeable" class="space-y-2 border-t border-outline-elevation-2 p-3">
        <div v-for="row in rows" :key="row.id" class="flex items-center justify-between gap-3">
          <label :for="row.id" class="text-base text-ink-gray-6">{{ row.label }}</label>
          <Select
            :id="row.id"
            class="w-36"
            :model-value="row.value"
            :options="row.options"
            @update:model-value="row.pick"
          />
        </div>
      </div>
      <div v-if="presentation.view === 'list' && columns.length" class="border-t border-outline-elevation-2 p-3">
        <h3 :id="columnsHeading" class="text-sm text-ink-gray-5">Columns</h3>
        <div role="group" :aria-labelledby="columnsHeading" class="mt-2 flex flex-wrap gap-1.5">
          <button
            v-for="column in columns"
            :key="column"
            type="button"
            :aria-pressed="shown(column)"
            class="h-7 rounded-full border px-2.5 text-sm transition-colors"
            :class="shown(column)
              ? 'border-transparent bg-surface-gray-3 text-ink-gray-8 hover:bg-surface-gray-4'
              : 'border-outline-gray-2 text-ink-gray-5 hover:bg-surface-gray-2 hover:text-ink-gray-7'"
            @click="emit('toggle-column', column, !shown(column))"
          >
            {{ COLUMN_LABELS[column] }}
          </button>
        </div>
      </div>
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'
import { Button, Popover, Select, TabButtons, type SelectOption } from 'frappe-ui'
import type {
  FilesColumn,
  FilesDirection,
  FilesSort,
  FilesViewMode,
  PresentationChange,
  PresentationState,
} from './presentation'

const props = defineProps<{
  presentation: PresentationState
  /** Whether the place can be sorted. Search and the saved views keep the server's order. */
  arrangeable: boolean
  /** The optional list columns this place offers. */
  columns: readonly FilesColumn[]
}>()

const emit = defineEmits<{
  change: [change: PresentationChange]
  'toggle-column': [column: FilesColumn, visible: boolean]
}>()

const VIEW_OPTIONS = [
  { value: 'list', label: 'List', iconLeft: 'lucide-list' },
  { value: 'grid', label: 'Grid', iconLeft: 'lucide-layout-grid' },
] satisfies Array<{ value: FilesViewMode; label: string; iconLeft: string }>
const SORT_LABELS: Record<FilesSort, string> = { title: 'Name', modified: 'Modified', owner: 'Owner', kind: 'Type', size: 'Size' }
const COLUMN_LABELS: Record<FilesColumn, string> = { owner: 'Owner', modified: 'Modified', kind: 'Type', size: 'Size' }

/** Each direction in the words of its field: `A to Z`, `Newest first`. */
function orderLabel(sort: FilesSort, dir: FilesDirection): string {
  if (sort === 'modified') return dir === 'asc' ? 'Oldest first' : 'Newest first'
  if (sort === 'size') return dir === 'asc' ? 'Smallest first' : 'Largest first'
  return dir === 'asc' ? 'A to Z' : 'Z to A'
}

const sortId = useId()
const orderId = useId()
const columnsHeading = useId()

/** One label-and-select row. `pick` only reports a value the row offers. */
function row<T extends string>(id: string, label: string, value: T, labels: Record<T, string>, onPick: (value: T) => void) {
  const values = Object.keys(labels) as T[]
  return {
    id,
    label,
    value,
    options: values.map((option): SelectOption => ({ value: option, label: labels[option] })),
    pick: (next: unknown) => {
      const picked = values.find((option) => option === next)
      if (picked && picked !== value) onPick(picked)
    },
  }
}

const rows = computed(() => {
  const { sort, dir } = props.presentation
  return [
    row(sortId, 'Sort by', sort, SORT_LABELS, (next) => emit('change', { sort: next })),
    row(orderId, 'Order', dir, { asc: orderLabel(sort, 'asc'), desc: orderLabel(sort, 'desc') }, (next) => emit('change', { dir: next })),
  ]
})

function pickView(next: unknown) {
  const picked = VIEW_OPTIONS.find((option) => option.value === next)?.value
  if (picked && picked !== props.presentation.view) emit('change', { view: picked })
}

function shown(column: FilesColumn): boolean {
  return props.presentation.columns.includes(column)
}
</script>
