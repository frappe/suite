<template>
  <!-- Right-click menu over the grid: column-header, row-header or cell items
  by `menu.mode`. Cursor-anchored; flips upward when there's no room below. -->
  <div
    class="sn-ctx-menu"
    :style="
      menu.useBottom
        ? {
            left: menu.x + 'px',
            bottom: menu.bottom + 'px',
            maxHeight: menu.maxH + 'px',
          }
        : {
            left: menu.x + 'px',
            top: menu.y + 'px',
            maxHeight: menu.maxH + 'px',
          }
    "
  >
    <!-- Column-header menu -->
    <template v-if="menu.mode === 'colHeader'">
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-arrow-left"
        label="Insert column left"
        @click="emit('insert-col', false)"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-arrow-right"
        label="Insert column right"
        @click="emit('insert-col', true)"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-plus"
        label="Insert N columns…"
        @click="emit('insert-many', 'col')"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-trash-2"
        label="Delete column"
        @click="emit('delete-col')"
      />
      <hr class="sn-ctx-sep" />
      <Button
        v-if="menu.targetCol > 0"
        variant="ghost"
        size="sm"
        icon-left="lucide-chevron-left"
        label="Move column left"
        @click="emit('move-col-left')"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-chevron-right"
        label="Move column right"
        @click="emit('move-col-right')"
      />
      <hr class="sn-ctx-sep" />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-maximize-2"
        label="Auto-fit width"
        @click="emit('auto-fit-col')"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-eye-off"
        label="Hide column"
        @click="emit('hide-cols')"
      />
      <Button
        v-if="hasHiddenCols"
        variant="ghost"
        size="sm"
        icon-left="lucide-eye"
        label="Unhide all columns"
        @click="emit('unhide-all-cols')"
      />
      <hr class="sn-ctx-sep" />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-lock"
        label="Freeze up to this column"
        @click="emit('freeze-col')"
      />
      <Button
        v-if="freezeCols > 0"
        variant="ghost"
        size="sm"
        icon-left="lucide-unlock"
        label="Unfreeze columns"
        @click="emit('unfreeze-cols')"
      />
    </template>

    <!-- Row-header menu -->
    <template v-else-if="menu.mode === 'rowHeader'">
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-arrow-up"
        label="Insert row above"
        @click="emit('insert-row', false)"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-arrow-down"
        label="Insert row below"
        @click="emit('insert-row', true)"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-plus"
        label="Insert N rows…"
        @click="emit('insert-many', 'row')"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-trash-2"
        label="Delete row"
        @click="emit('delete-row')"
      />
      <hr class="sn-ctx-sep" />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-maximize-2"
        label="Auto-fit height"
        @click="emit('auto-fit-row')"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-eye-off"
        label="Hide row"
        @click="emit('hide-rows')"
      />
      <Button
        v-if="hasHiddenRows"
        variant="ghost"
        size="sm"
        icon-left="lucide-eye"
        label="Unhide all rows"
        @click="emit('unhide-all-rows')"
      />
      <hr class="sn-ctx-sep" />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-lock"
        label="Freeze up to this row"
        @click="emit('freeze-row')"
      />
      <Button
        v-if="freezeRows > 0"
        variant="ghost"
        size="sm"
        icon-left="lucide-unlock"
        label="Unfreeze rows"
        @click="emit('unfreeze-rows')"
      />
    </template>

    <!-- Cell menu (default) -->
    <template v-else>
      <Button
        v-if="canPaste"
        variant="ghost"
        size="sm"
        icon-left="lucide-clipboard"
        label="Paste values only"
        @click="emit('paste-special', 'values')"
      />
      <Button
        v-if="canPaste"
        variant="ghost"
        size="sm"
        icon-left="lucide-clipboard"
        label="Paste formats only"
        @click="emit('paste-special', 'formats')"
      />
      <Button
        v-if="canPaste"
        variant="ghost"
        size="sm"
        icon-left="lucide-clipboard"
        label="Paste formulas only"
        @click="emit('paste-special', 'formulas')"
      />
      <hr v-if="canPaste" class="sn-ctx-sep" />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-arrow-up"
        label="Insert row above"
        @click="emit('insert-row', false)"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-arrow-down"
        label="Insert row below"
        @click="emit('insert-row', true)"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-trash-2"
        label="Delete row"
        @click="emit('delete-row')"
      />
      <hr class="sn-ctx-sep" />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-arrow-left"
        label="Insert column left"
        @click="emit('insert-col', false)"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-arrow-right"
        label="Insert column right"
        @click="emit('insert-col', true)"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-trash-2"
        label="Delete column"
        @click="emit('delete-col')"
      />
      <hr class="sn-ctx-sep" />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-lock"
        label="Freeze rows to here"
        @click="emit('freeze-row')"
      />
      <Button
        v-if="freezeRows > 0"
        variant="ghost"
        size="sm"
        icon-left="lucide-unlock"
        label="Unfreeze rows"
        @click="emit('unfreeze-rows')"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-lock"
        label="Freeze cols to here"
        @click="emit('freeze-col')"
      />
      <Button
        v-if="freezeCols > 0"
        variant="ghost"
        size="sm"
        icon-left="lucide-unlock"
        label="Unfreeze cols"
        @click="emit('unfreeze-cols')"
      />
      <hr class="sn-ctx-sep" />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-square-check"
        label="Data validation…"
        @click="emit('validation')"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-blend"
        label="Conditional format…"
        @click="emit('cond-format')"
      />
      <Button
        v-if="!rangeProtected"
        variant="ghost"
        size="sm"
        icon-left="lucide-lock"
        label="Protect range"
        @click="emit('protect')"
      />
      <Button
        v-else
        variant="ghost"
        size="sm"
        icon-left="lucide-unlock"
        label="Remove protection"
        @click="emit('unprotect')"
      />
      <hr class="sn-ctx-sep" />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-columns"
        label="Split text to columns"
        @click="emit('split-text')"
      />
      <hr class="sn-ctx-sep" />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-layout"
        label="Insert pivot table…"
        @click="emit('pivot')"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-chart-bar"
        label="Insert chart…"
        @click="emit('chart')"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-left="lucide-filter"
        label="Insert slicer"
        @click="emit('slicer')"
      />
      <hr v-if="showCellHistory" class="sn-ctx-sep" />
      <Button
        v-if="showCellHistory"
        variant="ghost"
        size="sm"
        icon-left="lucide-history"
        :label="`Cell history for ${activeCell}`"
        @click="emit('cell-history')"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
// The right-click context menu, extracted from SheetEditor/index.vue. It only
// renders: useContextMenu.js positions it and picks the mode, and every item
// reports back to the editor, whose handlers close the menu and do the work.
import { Button } from 'frappe-ui'

type ContextMenu = {
  x: number
  y: number
  bottom: number
  useBottom: boolean
  maxH: number
  targetCol: number
  mode: 'cell' | 'colHeader' | 'rowHeader'
}

defineProps<{
  menu: ContextMenu
  freezeRows: number
  freezeCols: number
  hasHiddenRows: boolean
  hasHiddenCols: boolean
  canPaste: boolean
  rangeProtected: boolean
  showCellHistory: boolean
  activeCell: string
}>()
const emit = defineEmits<{
  'insert-row': [below: boolean]
  'insert-col': [right: boolean]
  'insert-many': [kind: 'row' | 'col']
  'delete-row': []
  'delete-col': []
  'move-col-left': []
  'move-col-right': []
  'auto-fit-row': []
  'auto-fit-col': []
  'hide-rows': []
  'hide-cols': []
  'unhide-all-rows': []
  'unhide-all-cols': []
  'freeze-row': []
  'freeze-col': []
  'unfreeze-rows': []
  'unfreeze-cols': []
  'paste-special': [kind: 'values' | 'formats' | 'formulas']
  validation: []
  'cond-format': []
  protect: []
  unprotect: []
  'split-text': []
  pivot: []
  chart: []
  slicer: []
  'cell-history': []
}>()
</script>

<style scoped>
/* Same rules as SheetTabMenu.vue: the two menus look alike. */
.sn-ctx-menu {
  position: fixed;
  z-index: 9000;
  background: var(--surface-elevation-2);
  border: 1px solid var(--outline-elevation-2);
  border-radius: 10px;
  box-shadow:
    0 0 1px rgba(0, 0, 0, 0.35),
    0 6px 8px -4px rgba(0, 0, 0, 0.1);
  padding: 4px;
  min-width: 208px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
}
/* Frappe UI Button defaults to `justify-content:center`. Override inside
   context menus so every row's icon sits at the same left padding and the
   labels line up regardless of length. */
.sn-ctx-menu :deep(button) {
  width: 100%;
  justify-content: flex-start;
  padding-left: 10px;
  padding-right: 10px;
}
.sn-ctx-sep {
  height: 1px;
  background: var(--outline-gray-1);
  margin: 4px 0;
  border: none;
}
</style>
