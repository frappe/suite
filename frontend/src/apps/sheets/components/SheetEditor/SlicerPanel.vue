<template>
  <!-- Slicer — a floating value-filter control bound to a filter column -->
  <div class="sn-slicer" :style="{ left: slicer.x + 'px', top: slicer.y + 'px' }">
    <div class="sn-slicer-head" @mousedown="emit('drag-start', $event)">
      <Dropdown :options="slicerColMenu" class="sn-slicer-colsel">
        <template #default="{ open }">
          <Button
            :variant="open ? 'subtle' : 'ghost'"
            size="sm"
            icon-right="lucide-chevron-down"
            :label="slicer.label"
            tooltip="Filter column"
            @mousedown.stop
            @click.stop
          />
        </template>
      </Dropdown>
      <Button
        aria-label="Remove slicer"
        variant="ghost"
        size="sm"
        icon="lucide-x"
        tooltip="Remove slicer"
        @mousedown.stop
        @click="emit('remove')"
      />
    </div>
    <div class="sn-fp-vlinks sn-slicer-actions" @mousedown.stop>
      <Button variant="ghost" size="sm" label="Select all" @click="emit('select-all')" />
      <Button variant="ghost" size="sm" label="Clear" @click="emit('clear')" />
    </div>
    <div class="sn-slicer-values">
      <div
        v-for="row in slicer.rows"
        :key="'v:' + row.v"
        class="sn-fp-value-row"
        @click="emit('toggle', row.v)"
      >
        <Checkbox
          :model-value="row.checked"
          :aria-label="row.v === '' ? '(Blanks)' : row.v"
          @update:model-value="emit('toggle', row.v)"
          @click.stop
        />
        <span class="sn-fp-value-text">{{ row.v === '' ? '(Blanks)' : row.v }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// One slicer panel, extracted from SheetEditor/index.vue. It renders the plain
// snapshot useSlicers.js derives (label, column options, checked rows) and
// reports clicks back; all filter state lives in the editor.
import { Button, Checkbox, Dropdown } from 'frappe-ui'
import { computed } from 'vue'

type Slicer = {
  id: number
  col: number
  x: number
  y: number
  label: string
  options: { label: string; value: number }[]
  rows: { v: string; checked: boolean }[]
}

const props = defineProps<{ slicer: Slicer }>()
const emit = defineEmits<{
  'drag-start': [e: MouseEvent]
  'change-col': [col: number]
  remove: []
  'select-all': []
  clear: []
  toggle: [v: string]
}>()

// frappe-ui Dropdown options for a slicer's column picker — a styled, teleported
// popover (not a native <select>, which overflowed the floating panel). The
// current column is marked so the menu reads like a real selector.
const slicerColMenu = computed(() =>
  props.slicer.options.map((o) => ({
    label: o.label,
    icon: o.value === props.slicer.col ? 'check' : null,
    onClick: () => emit('change-col', o.value),
  })),
)
</script>

<style scoped>
/* Slicers — floating value-filter controls */
.sn-slicer {
  position: fixed;
  z-index: 8400;
  width: 220px;
  background: var(--surface-elevation-2);
  border: 1px solid var(--outline-elevation-2);
  border-radius: 10px;
  box-shadow:
    0 0 1px rgba(0, 0, 0, 0.35),
    0 6px 8px -4px rgba(0, 0, 0, 0.1);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sn-slicer-head {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: move;
  user-select: none;
}
.sn-slicer-colsel {
  flex: 1 1 auto;
  min-width: 0;
}
.sn-slicer-colsel :deep(button) {
  width: 100%;
  justify-content: space-between;
  font-weight: 600;
}
.sn-slicer-colsel :deep(button > span) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sn-slicer-actions {
  margin: -2px 0;
}
.sn-slicer-values {
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--outline-gray-2);
  border-radius: 8px;
  padding: 4px 0;
  background: var(--surface-base);
}

/* Shared with FilterPanel.vue (the slicer's actions and value rows use the
   filter panel's classes). */
.sn-fp-vlinks {
  display: flex;
  align-items: center;
  gap: 2px;
}
.sn-fp-value-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 13px;
  letter-spacing: 0.01em;
  color: var(--ink-gray-8);
}
.sn-fp-value-row:hover {
  background: var(--surface-gray-2);
}
.sn-fp-value-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
