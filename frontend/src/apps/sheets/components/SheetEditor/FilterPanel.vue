<template>
  <!-- Inline filter panel — sort + condition + Google-Sheets-style
     "Filter by values" checklist with search and Select all/Clear. -->
  <div class="sn-filter-panel">
    <div class="sn-fp-title">Column {{ colLabel(col) }}</div>
    <div class="sn-fp-row">
      <Button
        class="sn-fp-grow"
        size="sm"
        icon-left="lucide-arrow-up"
        label="A → Z"
        tooltip="Sort ascending"
        @click="emit('sort', 'asc')"
      />
      <Button
        class="sn-fp-grow"
        size="sm"
        icon-left="lucide-arrow-down"
        label="Z → A"
        tooltip="Sort descending"
        @click="emit('sort', 'desc')"
      />
    </div>

    <!-- Mode toggle: condition vs values. Labels are short ("Values" /
       "Condition") so both fit inside the 260 px panel at the default
       Button text-base size — the full "Filter by …" wording overflowed
       at this width. Both modes share the Apply/Clear actions at the
       bottom, so the user can flip between modes before committing. -->
    <div class="sn-fp-mode" role="tablist" aria-label="Filter mode">
      <Button
        class="sn-fp-grow"
        size="sm"
        :variant="panel.mode === 'values' ? 'subtle' : 'ghost'"
        label="Values"
        @click="panel.mode = 'values'"
      />
      <Button
        class="sn-fp-grow"
        size="sm"
        :variant="panel.mode === 'condition' ? 'subtle' : 'ghost'"
        label="Condition"
        @click="panel.mode = 'condition'"
      />
    </div>

    <!-- Filter by values -->
    <template v-if="panel.mode === 'values'">
      <!-- When a search is active these act on the *shown* matches only
         (Google-Sheets behaviour). Relabel so it's obvious — otherwise
         "Clear" during a search reads as "clear everything" and silently
         leaves the hidden values checked. -->
      <div class="sn-fp-vlinks">
        <Button
          variant="ghost"
          size="sm"
          :label="valueSearchActive ? 'Select shown' : 'Select all'"
          @click="selectAllFilterValues"
        />
        <Button
          variant="ghost"
          size="sm"
          :label="valueSearchActive ? 'Clear shown' : 'Clear'"
          @click="clearAllFilterValues"
        />
        <span class="sn-fp-count">Displaying {{ panel.valueSet.size }}</span>
      </div>
      <FormControl v-model="panel.valueSearch" type="text" size="sm" placeholder="Search…">
        <template #prefix>
          <FeatherIcon name="search" class="sn-fp-search-icon" />
        </template>
      </FormControl>
      <div class="sn-fp-values">
        <div
          v-for="v in filteredFilterValues"
          :key="v || '__blanks__'"
          class="sn-fp-value-row"
          @click="toggleFilterValue(v)"
        >
          <Checkbox
            :model-value="panel.valueSet.has(v)"
            :aria-label="v === '' ? '(Blanks)' : v"
            @update:model-value="toggleFilterValue(v)"
            @click.stop
          />
          <span class="sn-fp-value-text">{{ v === '' ? '(Blanks)' : v }}</span>
        </div>
        <div v-if="!filteredFilterValues.length" class="sn-fp-empty">No matching values</div>
      </div>
    </template>

    <!-- Filter by condition -->
    <template v-else>
      <FormControl
        v-model="panel.operator"
        type="select"
        size="sm"
        :options="FILTER_OPERATOR_OPTIONS"
        aria-label="Condition"
      />
      <FormControl
        v-if="!['empty', 'notempty'].includes(panel.operator)"
        v-model="panel.value"
        type="text"
        size="sm"
        placeholder="Value"
        @keydown.enter="applyFilter"
      />
    </template>

    <div class="sn-fp-actions">
      <Button class="sn-fp-grow" variant="solid" size="sm" label="Apply" @click="applyFilter" />
      <Button class="sn-fp-grow" size="sm" label="Clear" @click="emit('clear')" />
      <Button class="sn-fp-grow" size="sm" label="Close" @click="emit('close')" />
    </div>
  </div>
</template>

<script setup lang="ts">
// The filter panel's form, extracted from SheetEditor/index.vue. The editor
// (useSortFilter.js) owns where it sits and whether it's open, and re-creates
// it on every open, so the form starts from `spec` each time. It hands back a
// filter spec on Apply, or null when every value is checked (= no filter).
import { Button, Checkbox, FormControl } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue'

import { colLabel } from '../../utils/cells.js'

type FilterSpec = { operator: string; value?: string; values?: string[] }

const props = defineProps<{
  col: number
  allValues: string[]
  spec: FilterSpec | null
}>()
const emit = defineEmits<{
  apply: [spec: FilterSpec | null]
  clear: []
  close: []
  sort: [dir: 'asc' | 'desc']
}>()

const FILTER_OPERATOR_OPTIONS = [
  {
    label: 'Contains',
    value: 'contains',
  },
  {
    label: 'Equals',
    value: 'equals',
  },
  {
    label: 'Greater than',
    value: 'gt',
  },
  {
    label: 'Less than',
    value: 'lt',
  },
  {
    label: 'Is empty',
    value: 'empty',
  },
  {
    label: 'Is not empty',
    value: 'notempty',
  },
]

// Form state.
//   - mode: 'values' (Google-Sheets-style checklist) or 'condition' (operator
//     + value). Default to 'values' since that's the more discoverable path.
//   - valueSet: which distinct displayed values are currently checked. Stored
//     as a real Set for O(1) toggles; serialised to an array when applied.
const panel = reactive({
  mode: 'values',
  operator: 'contains',
  value: '',
  valueSet: new Set<string>(),
  valueSearch: '',
})
// Decide initial mode + state from the existing spec (if any). `inSet`
// → values mode with the saved selection; condition-style ops → condition
// mode; nothing saved → default values mode with every value checked.
const existing = props.spec
if (existing?.operator === 'inSet') {
  panel.valueSet = new Set(existing.values || [])
} else if (existing) {
  panel.mode = 'condition'
  panel.operator = existing.operator || 'contains'
  panel.value = existing.value || ''
  panel.valueSet = new Set(props.allValues)
} else {
  panel.valueSet = new Set(props.allValues)
}

const filteredFilterValues = computed(() => {
  const q = panel.valueSearch.trim().toLowerCase()
  if (!q) return props.allValues
  return props.allValues.filter((v) => String(v).toLowerCase().includes(q))
})

// True while the value search box narrows the list — Select all / Clear then
// act on the shown subset, so their labels change to say so.
const valueSearchActive = computed(() => panel.valueSearch.trim() !== '')
function toggleFilterValue(v: string) {
  if (panel.valueSet.has(v)) panel.valueSet.delete(v)
  else panel.valueSet.add(v)
}
function selectAllFilterValues() {
  // Only the values currently visible under the search filter — matches
  // Google Sheets behaviour where "Select all" respects the search box.
  for (const v of filteredFilterValues.value) panel.valueSet.add(v)
}
function clearAllFilterValues() {
  for (const v of filteredFilterValues.value) panel.valueSet.delete(v)
}

function applyFilter() {
  if (panel.mode === 'values') {
    // No-op safety: an all-checked selection is identical to no filter at
    // all, so clear the column entry instead of saving every value.
    if (panel.valueSet.size === props.allValues.length) emit('apply', null)
    else emit('apply', { operator: 'inSet', values: [...panel.valueSet] })
  } else {
    emit('apply', { operator: panel.operator, value: panel.value })
  }
}

// Auto-close the filter popover on any click outside its body or the
// chevron that opened it. Mirrors how Google Sheets handles this — users
// shouldn't have to remember to hit "Close" before editing a cell.
function _filterPanelOutsideClick(e: MouseEvent) {
  const t = e.target
  if (!t || !(t instanceof Element)) return
  if (t.closest('.sn-filter-panel')) return // click inside the popover itself
  if (t.closest('.sn-filter-btn')) return // click on a chevron toggles its own panel
  // Frappe UI's Select/Combobox/Dropdown render their dropdown into a portal
  // (SelectPortal → body), so the listbox options live OUTSIDE the panel's
  // DOM subtree. Without this exemption, clicking "Equals" / "Greater than"
  // on the condition-mode operator picker fired the outside-click handler
  // and slammed the whole panel shut. The portaled content is tagged with
  // data-slot="content" on the wrapper, so an ancestor match catches every
  // descendant click (items, scroll viewport, etc.).
  if (t.closest('[data-slot="content"]')) return
  emit('close')
}
// `mousedown` (not click) so the close fires before any other component
// gets the focus/selection event — keeps the panel from leaving stale
// state behind when the user just clicks elsewhere in the sheet.
onMounted(() => document.addEventListener('mousedown', _filterPanelOutsideClick, true))
onBeforeUnmount(() => document.removeEventListener('mousedown', _filterPanelOutsideClick, true))
</script>

<style scoped>
.sn-filter-panel {
  position: absolute;
  z-index: 100;
  background: var(--surface-elevation-2);
  border: 1px solid var(--outline-elevation-2);
  border-radius: 10px;
  box-shadow:
    0 0 1px rgba(0, 0, 0, 0.35),
    0 6px 8px -4px rgba(0, 0, 0, 0.1);
  padding: 12px;
  width: 260px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sn-fp-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--ink-gray-8);
  padding-bottom: 2px;
}
.sn-fp-row {
  display: flex;
  gap: 4px;
}
.sn-fp-mode {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--outline-gray-2);
  border-radius: 8px;
  background: var(--surface-base);
}
.sn-fp-actions {
  display: flex;
  gap: 4px;
  padding-top: 2px;
}
.sn-fp-grow {
  flex: 1;
}

/* "Filter by values" mode — every interactive element is a Frappe UI primitive
   (Button, Checkbox, FormControl), so the per-class rules here only handle
   layout and the value-list row chrome. */
.sn-fp-vlinks {
  display: flex;
  align-items: center;
  gap: 2px;
}
.sn-fp-count {
  margin-left: auto;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--ink-gray-5);
}
.sn-fp-search-icon {
  width: 13px;
  height: 13px;
  color: var(--ink-gray-5);
}
.sn-fp-values {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--outline-gray-2);
  border-radius: 8px;
  padding: 4px 0;
  background: var(--surface-base);
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
.sn-fp-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--ink-gray-5);
  text-align: center;
}
</style>
