<!-- The admin table: frappe-ui List with column headers, placeholder rows while loading, optional row links and selection, and an empty state. Cells show the column's value unless the page overrides them in the `cell` slot. -->
<script setup lang="ts" generic="Row extends object">
import { Button } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import DashboardSkeletonText from './DashboardSkeletonText.vue'

export type DashboardListColumn = {
  label: string
  key: string
  /** A CSS track size, or a number of fractions. Defaults to an equal share. */
  width?: string | number
}

const selection = defineModel<string[]>('selection', { default: () => [] })
const {
  columns,
  rows,
  rowKey,
  loading = false,
  selectable = false,
  rowHeight = 44,
  rowRoute,
  emptyState,
  skeletonRows = 8,
} = defineProps<{
  columns: DashboardListColumn[]
  rows: readonly Row[]
  rowKey: string
  loading?: boolean
  selectable?: boolean
  /** Fixed row height in px, shared by placeholder and real rows. */
  rowHeight?: number
  rowRoute?: (row: NoInfer<Row>) => RouteLocationRaw
  /** How many placeholder rows to show while loading. */
  skeletonRows?: number
  emptyState?: {
    title: string
    description?: string
    button?: { label: string; onClick: () => void }
  }
}>()
defineSlots<{
  cell?: (props: { column: DashboardListColumn; row: Row; item: unknown }) => unknown
}>()

const tracks = computed(() =>
  columns.map(({ width }) =>
    width === undefined
      ? 'minmax(0,1fr)'
      : typeof width === 'number'
        ? `minmax(0,${width}fr)`
        : width,
  ),
)
const placeholders = computed(() =>
  Array.from({ length: skeletonRows }, (_, index) => ({ key: `skeleton-${index}` })),
)
const field = (row: Row, key: string) => (row as Record<string, unknown>)[key]
const valueOf = (row: Row) => String(field(row, rowKey))
// Deterministic pseudo-random widths so the placeholder reads as text of varying length.
const widthFor = (row: number, column: number) => `${45 + ((row * 7 + column * 13) % 40)}%`
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <List
      v-model:selection="selection"
      :selectable="selectable"
      class="-mx-3 list-row-px-3"
      :columns="tracks"
      :row-height="rowHeight"
    >
      <ListHeader>
        <ListHeaderCell v-for="column in columns" :key="column.key">
          {{ column.label }}
        </ListHeaderCell>
      </ListHeader>
      <ListRows v-if="loading" v-slot="{ index }" :items="placeholders" row-key="key">
        <ListRow class="pointer-events-none" aria-hidden="true">
          <ListCell v-for="(column, columnIndex) in columns" :key="column.key">
            <DashboardSkeletonText :width="widthFor(index, columnIndex)" />
          </ListCell>
        </ListRow>
      </ListRows>
      <ListRows v-else v-slot="{ item: row }" :items="rows as Row[]" :row-key="rowKey">
        <ListRow :value="valueOf(row)" :route="rowRoute?.(row)">
          <ListCell v-for="column in columns" :key="column.key">
            <slot name="cell" :column="column" :row="row" :item="field(row, column.key)">
              <span
                class="truncate text-base"
                :class="column === columns[0] ? 'text-ink-gray-8' : 'text-ink-gray-7'"
              >
                {{ field(row, column.key) ?? '—' }}
              </span>
            </slot>
          </ListCell>
        </ListRow>
      </ListRows>
    </List>
    <div
      v-if="!loading && !rows.length && emptyState"
      class="flex flex-col items-center gap-1 py-12 text-center"
    >
      <p class="text-base font-medium text-ink-gray-8">{{ emptyState.title }}</p>
      <p v-if="emptyState.description" class="text-p-sm text-ink-gray-5">
        {{ emptyState.description }}
      </p>
      <Button
        v-if="emptyState.button"
        class="mt-3"
        variant="solid"
        :label="emptyState.button.label"
        @click="emptyState.button.onClick"
      />
    </div>
  </div>
</template>
