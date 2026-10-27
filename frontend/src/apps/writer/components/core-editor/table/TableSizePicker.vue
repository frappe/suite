<template>
  <!-- Not dismissible: the menu that opens the grid hands focus back after it opens, which would close it -->
  <Popover open trigger="manual" :dismissible="false">
    <template #trigger>
      <span class="pointer-events-none fixed" :style="anchorStyle" aria-hidden="true" />
    </template>
    <div ref="panel" class="p-2.5" data-slot="table-size-picker">
      <div
        ref="grid"
        tabindex="0"
        role="grid"
        :aria-label="__('Table size, {0} rows by {1} columns', [rows, columns])"
        class="grid w-max gap-1 outline-none"
        :style="{ gridTemplateColumns: `repeat(${MAX.columns}, minmax(0, 1fr))` }"
      >
        <template v-for="row in MAX.rows" :key="row">
          <button
            v-for="column in MAX.columns"
            :key="column"
            type="button"
            tabindex="-1"
            class="size-4 rounded-sm border"
            :class="
              row <= rows && column <= columns
                ? 'border-outline-gray-3 bg-surface-gray-4'
                : 'border-outline-gray-2 bg-surface-gray-1'
            "
            :aria-label="`${row} × ${column}`"
            @pointerenter="setSize(row, column)"
            @click="emit('pick', { rows: row, columns: column })"
          />
        </template>
      </div>
      <div class="mt-2 text-center text-sm text-ink-gray-7">
        {{ __('{0} × {1}', [rows, columns]) }}
      </div>
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { Popover } from 'frappe-ui'
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'

import { translate as __ } from '@/platform/translation'

import type { Box } from './selectionRing'

/**
 * The rows-by-columns grid that sizes a new table, from frappe-ui
 * src/molecules/editor/components/table-size-picker/TableSizePicker.vue. The pointer sweeps the
 * grid; the arrow keys grow and shrink the size, Enter inserts it, and Escape closes the grid.
 */
const props = defineProps<{ anchor: Box }>()
const emit = defineEmits<{ pick: [size: { rows: number; columns: number }]; close: [] }>()

const MAX = { rows: 6, columns: 8 }
const STEPS: Record<string, [number, number]> = {
  ArrowDown: [1, 0],
  ArrowUp: [-1, 0],
  ArrowRight: [0, 1],
  ArrowLeft: [0, -1],
}

const rows = ref(3)
const columns = ref(3)
const grid = useTemplateRef<HTMLElement>('grid')
const panel = useTemplateRef<HTMLElement>('panel')

// While the grid is open the arrows, Enter and Escape drive it, wherever focus is
useEventListener(document, 'keydown', onKeydown, { capture: true })
useEventListener(
  document,
  'pointerdown',
  (event: PointerEvent) => {
    if (!(event.target instanceof Node) || !panel.value?.contains(event.target)) emit('close')
  },
  { capture: true },
)

const anchorStyle = computed(() => ({
  left: `${props.anchor.left}px`,
  top: `${props.anchor.top}px`,
  width: `${props.anchor.width}px`,
  height: `${props.anchor.height}px`,
}))

onMounted(() => void nextTick(() => grid.value?.focus()))

function setSize(row: number, column: number) {
  rows.value = row
  columns.value = column
}

function onKeydown(event: KeyboardEvent) {
  const step = STEPS[event.key]
  if (step || event.key === 'Enter' || event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
  }
  if (step) {
    rows.value = Math.min(Math.max(rows.value + step[0], 1), MAX.rows)
    columns.value = Math.min(Math.max(columns.value + step[1], 1), MAX.columns)
  } else if (event.key === 'Enter') {
    emit('pick', { rows: rows.value, columns: columns.value })
  } else if (event.key === 'Escape') {
    emit('close')
  }
}
</script>
