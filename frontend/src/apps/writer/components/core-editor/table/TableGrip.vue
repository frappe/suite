<template>
  <!-- Emptied, not disabled, while open: a disabled Tooltip remounts the button and drops the drag -->
  <Tooltip :text="open ? '' : label" :side="axis === 'column' ? 'top' : 'left'">
    <button
      type="button"
      class="writer-table-grip"
      :class="[`is-${axis}`, open && 'is-open']"
      :aria-label="label"
      aria-haspopup="menu"
      :aria-expanded="open"
      v-bind="$attrs"
    >
      <span class="size-3" :class="ICONS[axis]" aria-hidden="true" />
    </button>
  </Tooltip>
</template>

<script setup lang="ts">
import { Tooltip } from 'frappe-ui'

/** A row or column handle, a small pill with dots on the table's rule, or the cell menu's button */
defineProps<{ axis: 'row' | 'column' | 'cell'; open: boolean; label: string }>()

// Tooltip drops attributes, so the placement and the press and drag listeners go to the button
defineOptions({ inheritAttrs: false })

const ICONS = {
  row: 'lucide-grip-vertical',
  column: 'lucide-grip-horizontal',
  cell: 'lucide-chevron-down',
}
</script>
