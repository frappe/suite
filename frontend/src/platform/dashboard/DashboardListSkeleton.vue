<!-- Mirrors the frappe-ui ListView frame (header bar, grid columns, row height and
     dividers) with the page's real column labels, so the list does not shift when data
     arrives. -->
<template>
  <div
    class="pointer-events-none flex min-h-0 w-full flex-1 flex-col"
    role="status"
    :aria-label="__('Loading')"
  >
    <div
      class="mb-2 grid items-center gap-4 rounded-4 bg-surface-gray-2 p-2"
      :style="{ gridTemplateColumns }"
    >
      <Checkbox v-if="selectable" disabled />
      <div v-for="column in listColumns" :key="column.key" class="truncate text-sm text-ink-gray-5">
        {{ column.label }}
      </div>
    </div>
    <div v-for="row in rows" :key="row" aria-hidden="true">
      <div
        class="grid items-center gap-4 px-2"
        :style="{ gridTemplateColumns, height: `${rowHeight}px` }"
      >
        <Checkbox v-if="selectable" disabled />
        <Skeleton
          v-for="(column, index) in listColumns"
          :key="column.key"
          class="h-3 rounded-4"
          :style="{ width: `${widthFor(row, index)}%` }"
        />
      </div>
      <div v-if="row < rows" class="mx-2 h-px border-t border-outline-gray-1" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Checkbox, Skeleton } from 'frappe-ui'
import { computed } from 'vue'

type Column = { label: string; key: string; width?: string | number }

const {
  rows = 8,
  columns = 4,
  selectable = false,
  rowHeight = 40,
} = defineProps<{
  rows?: number
  /** The page's own list columns, or a count when there are no labels to show. */
  columns?: number | Column[]
  selectable?: boolean
  rowHeight?: number
}>()

const listColumns = computed<Column[]>(() =>
  typeof columns === 'number'
    ? Array.from({ length: columns }, (_, index) => ({ label: '\u00a0', key: `c${index}` }))
    : columns,
)
// Same column template ListView builds: a 14px checkbox track, then numeric widths as fr.
const gridTemplateColumns = computed(() =>
  [
    ...(selectable ? ['14px'] : []),
    ...listColumns.value.map(({ width = 1 }) => (typeof width === 'number' ? `${width}fr` : width)),
  ].join(' '),
)

// Deterministic pseudo-random widths so the placeholder reads as text of
// varying length instead of a uniform grid.
const widthFor = (row: number, column: number) => 45 + ((row * 7 + column * 13) % 40)
</script>
