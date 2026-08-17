<template>
  <Dialog
    v-model:open="show"
    :title="pivotId ? 'Edit pivot table' : 'Create pivot table'"
    size="lg"
    :dismissible="pickerOpenCount === 0"
  >
    <template #default>

      <!-- ── Source range ─────────────────────────────────────────────────── -->
      <div class="pv-section">
        <p class="pv-label">Source</p>
        <div class="pv-range-row">
          <!-- Source sheet picker. Auto-derived but explicit so the user
               can recover an existing pivot whose `sourceSheet` got
               corrupted to its own output-sheet name (legacy bug). -->
          <FormControl
            type="select"
            v-model="sourceSheetInput"
            :options="sheetOptions"
            class="pv-source-sheet"
            @update:model-value="detectFields"
          />
          <FormControl
            v-model="rangeInput"
            type="text"
            placeholder="e.g. A1:F100"
            class="pv-range-input"
            @blur="detectFields"
            @keydown.enter.prevent="detectFields"
          />
          <Button size="sm" variant="outline" label="Detect fields" @click="detectFields" />
        </div>
        <p v-if="rangeError" class="pv-error">{{ rangeError }}</p>
      </div>

      <!-- ── Buckets ──────────────────────────────────────────────────────── -->
      <div v-if="availableFields.length" class="pv-buckets">

        <!-- Rows -->
        <div class="pv-bucket">
          <p class="pv-bucket-label">
            <FeatherIcon name="align-left" class="pv-bucket-icon" /> Rows
          </p>
          <div class="pv-bucket-body">
            <div v-for="f in rowFields" :key="f" class="pv-chip">
              <span class="pv-chip-label">{{ f }}</span>
              <button class="pv-chip-x" @click="removeFrom('rows', f)">
                <FeatherIcon name="x" class="pv-chip-x-icon" />
              </button>
            </div>
            <PivotFieldPicker :fields="pickableFields('rows')" @select="f => addTo('rows', f)" @opened="pickerOpenCount++" @closed="pickerOpenCount--">
              <template #default="{ isOpen }">
                <Button size="sm" :variant="isOpen ? 'subtle' : 'ghost'" icon="lucide-plus" label="Add field" class="pv-add-btn" />
              </template>
            </PivotFieldPicker>
          </div>
        </div>

        <!-- Columns -->
        <div class="pv-bucket">
          <p class="pv-bucket-label">
            <FeatherIcon name="columns" class="pv-bucket-icon" /> Columns
          </p>
          <div class="pv-bucket-body">
            <div v-for="f in colFields" :key="f" class="pv-chip">
              <span class="pv-chip-label">{{ f }}</span>
              <button class="pv-chip-x" @click="removeFrom('cols', f)">
                <FeatherIcon name="x" class="pv-chip-x-icon" />
              </button>
            </div>
            <PivotFieldPicker :fields="pickableFields('cols')" @select="f => addTo('cols', f)" @opened="pickerOpenCount++" @closed="pickerOpenCount--">
              <template #default="{ isOpen }">
                <Button size="sm" :variant="isOpen ? 'subtle' : 'ghost'" icon="lucide-plus" label="Add field" class="pv-add-btn" />
              </template>
            </PivotFieldPicker>
          </div>
        </div>

        <!-- Values -->
        <div class="pv-bucket">
          <p class="pv-bucket-label">
            <FeatherIcon name="hash" class="pv-bucket-icon" /> Values
          </p>
          <div class="pv-bucket-body">
            <div v-for="v in valueFields" :key="v.field" class="pv-chip pv-chip--value">
              <Dropdown
                :options="aggOpts(v)"
                @update:open="onAggDropdownToggle"
              >
                <template #default="{ open }">
                  <button class="pv-agg-btn" :class="{ 'pv-agg-btn--open': open }">
                    {{ v.agg.toUpperCase() }}
                    <FeatherIcon name="chevron-down" class="pv-agg-chev" />
                  </button>
                </template>
              </Dropdown>
              <span class="pv-chip-label">{{ v.field }}</span>
              <button class="pv-chip-x" @click="removeFrom('values', v.field)">
                <FeatherIcon name="x" class="pv-chip-x-icon" />
              </button>
            </div>
            <PivotFieldPicker :fields="pickableFields('values')" @select="f => addTo('values', f)" @opened="pickerOpenCount++" @closed="pickerOpenCount--">
              <template #default="{ isOpen }">
                <Button size="sm" :variant="isOpen ? 'subtle' : 'ghost'" icon="lucide-plus" label="Add field" class="pv-add-btn" />
              </template>
            </PivotFieldPicker>
          </div>
        </div>

      </div>

      <!-- ── Preview ────────────────────────────────────────────────────────── -->
      <div v-if="previewTable.length" class="pv-section">
        <p class="pv-label">Preview <span class="pv-preview-hint">(first 6 rows)</span></p>
        <div class="pv-preview-wrap">
          <table class="pv-preview-table">
            <thead>
              <tr>
                <th v-for="(h, i) in previewTable[0]" :key="i" class="pv-th">{{ h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in previewTable.slice(1)" :key="ri" :class="{ 'pv-total-row': ri === previewTable.length - 2 }">
                <td v-for="(cell, ci) in row" :key="ci" class="pv-td" :class="{ 'pv-td--num': typeof cell === 'number' }">
                  {{ cell === '' ? '' : cell }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </template>

    <template #actions>
      <div class="flex flex-row-reverse gap-2">
        <Button
          variant="solid"
          :disabled="!canCreate"
          :label="pivotId ? 'Update pivot' : 'Create pivot'"
          @click="onConfirm"
        />
        <Button @click="show = false">Cancel</Button>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Button, Dialog, FormControl, Dropdown } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { AGG_OPTIONS, computePivot } from '../../engine/pivot.js'
import PivotFieldPicker from './PivotFieldPicker.vue'

const props = defineProps({
  modelValue:     { type: Boolean, default: false },
  sheet:          { type: Object,  required: true },
  currentSheet:   { type: String,  default: '' },
  initialRange:   { type: String,  default: '' },
  pivotId:        { type: String,  default: '' },
  existingConfig: { type: Object,  default: null },
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const show = computed({
  get: () => props.modelValue,
  set: v  => emit('update:modelValue', v),
})

// ── State ────────────────────────────────────────────────────────────────────

const rangeInput      = ref('')
const rangeError      = ref('')
const availableFields = ref([])
const rowFields       = ref([])
const colFields       = ref([])
const valueFields     = ref([])   // { field, agg }[]

// Tracks how many field-pickers are currently open. While > 0 we tell the
// frappe-ui Dialog NOT to close on outside-click, otherwise clicking a
// field in the (teleported) picker popover counts as "outside" to radix
// and the dialog closes mid-click — the user sees nothing happen.
const pickerOpenCount = ref(0)

// The actual sheet we read source data from. Lives as its own ref so the
// user can explicitly switch it via the source-sheet dropdown — necessary
// to recover pivots whose stored `sourceSheet` got pointed at their own
// output sheet by a legacy bug. We seed it from existingConfig (when
// editing) or currentSheet (when creating).
const sourceSheetInput = ref('')

// All sub-sheet names the user can pick as a source. We keep ALL sheets
// in the list (including the current one) — filtering "looks like a
// pivot output" would block valid cases like a user storing source data
// in a sheet called "Pivot 2024". Trust the user to pick correctly.
const sheetOptions = computed(() => {
  const names = props.sheet?.getSheetNames?.() || []
  return names.map(n => ({ label: n, value: n }))
})

watch(show, open => {
  if (!open) return
  if (props.existingConfig) {
    const c = props.existingConfig
    rangeInput.value  = c.sourceRange || ''
    rowFields.value   = [...(c.rows   || [])]
    colFields.value   = [...(c.cols   || [])]
    valueFields.value = (c.values || []).map(v => ({ ...v }))
    // Seed source-sheet picker. If the stored sourceSheet equals the
    // pivot's own outputSheet (legacy corruption), fall back to the first
    // available non-output sheet so the user lands on a sensible default
    // instead of a feedback loop.
    sourceSheetInput.value = _pickSourceSheet(c)
    _parseFields()
  } else {
    rangeInput.value       = props.initialRange || ''
    sourceSheetInput.value = props.currentSheet || sheetOptions.value[0]?.value || ''
    rowFields.value   = []
    colFields.value   = []
    valueFields.value = []
    availableFields.value = []
    if (rangeInput.value) detectFields()
  }
})

// ── Field detection ───────────────────────────────────────────────────────────

// If the saved sourceSheet is the pivot's own outputSheet (a corrupted
// state from the legacy save path), pick the first non-output sheet as a
// safer default. Otherwise return what the user / engine saved.
function _pickSourceSheet(cfg) {
  const saved = cfg?.sourceSheet
  if (saved && saved !== cfg?.outputSheet) return saved
  const all = sheetOptions.value.map(o => o.value)
  return all.find(n => n !== cfg?.outputSheet) || saved || props.currentSheet || ''
}

function _parseFields() {
  const range = rangeInput.value.trim()
  if (!range) { rangeError.value = 'Enter a range first.'; return false }
  const [start, end] = range.includes(':') ? range.split(':') : [range, range]
  const data = props.sheet.getRangeValues(start, end, sourceSheetInput.value)
  if (!data || !data[0]) { rangeError.value = 'Could not read range.'; return false }
  rangeError.value = ''
  // Filter out blank/null/zero cells — those are empty header columns
  availableFields.value = data[0]
    .filter(h => h !== null && h !== undefined && h !== '' && h !== 0)
    .map(h => String(h))
  return true
}

function detectFields() { _parseFields() }

// ── Field assignment ──────────────────────────────────────────────────────────

function pickableFields(bucket) {
  const taken = bucket === 'rows'   ? new Set(rowFields.value)
              : bucket === 'cols'   ? new Set(colFields.value)
              :                       new Set(valueFields.value.map(v => v.field))
  return availableFields.value.filter(f => !taken.has(f))
}

function addTo(bucket, f) {
  if (bucket === 'rows'   && !rowFields.value.includes(f))              rowFields.value.push(f)
  if (bucket === 'cols'   && !colFields.value.includes(f))              colFields.value.push(f)
  if (bucket === 'values' && !valueFields.value.some(v => v.field === f)) valueFields.value.push({ field: f, agg: 'sum' })
}

function removeFrom(bucket, f) {
  if (bucket === 'rows')   rowFields.value   = rowFields.value.filter(x => x !== f)
  if (bucket === 'cols')   colFields.value   = colFields.value.filter(x => x !== f)
  if (bucket === 'values') valueFields.value = valueFields.value.filter(v => v.field !== f)
}

function aggOpts(v) {
  return AGG_OPTIONS.map(o => ({
    label:   o.label,
    onClick: () => { v.agg = o.value },
  }))
}

// Reuses the dialog's pickerOpenCount gate — when an agg dropdown is open,
// the dialog must treat clicks on its portaled popover as "inside" the
// modal, else picking COUNT/AVERAGE would dismiss the dialog before the
// option's onClick fires.
function onAggDropdownToggle(open) {
  pickerOpenCount.value += open ? 1 : -1
}

// ── Preview ───────────────────────────────────────────────────────────────────

const previewTable = computed(() => {
  if (!rowFields.value.length || !valueFields.value.length || !rangeInput.value) return []
  const config = {
    sourceSheet: sourceSheetInput.value,
    sourceRange: rangeInput.value.trim(),
    rows:   rowFields.value,
    cols:   colFields.value,
    values: valueFields.value,
  }
  const table = computePivot(config, (s, e, sh) => props.sheet.getRangeValues(s, e, sh))
  return table.slice(0, 7)   // header + 5 data rows + total
})

// ── Confirm ───────────────────────────────────────────────────────────────────

const canCreate = computed(() =>
  availableFields.value.length > 0
  && rowFields.value.length > 0
  && valueFields.value.length > 0
  && !rangeError.value
)

function onConfirm() {
  if (!canCreate.value) return
  emit('confirm', {
    id:          props.pivotId || undefined,
    sourceSheet: sourceSheetInput.value,
    sourceRange: rangeInput.value.trim(),
    rows:        [...rowFields.value],
    cols:        [...colFields.value],
    values:      valueFields.value.map(v => ({ ...v })),
  })
  show.value = false
}
</script>

<style scoped>
.pv-section { margin-bottom: 20px; }

.pv-label {
  font-size: 12px; font-weight: 600; color: var(--ink-gray-6);
  text-transform: uppercase; letter-spacing: .04em; margin: 0 0 8px;
}

.pv-range-row { display: flex; gap: 8px; align-items: center; min-width: 0; }
/* TextInput's outer flex item shrinks to zero by default because its inner
   wrapper has no intrinsic width and our `flex: 1` doesn't propagate past
   the FormControl root in some FormControl/TextInput render paths. Pin a
   min-width so it always shows the range, and let flex grow from there. */
.pv-range-input  { flex: 1 1 0; min-width: 220px; }
/* Frappe UI's Select trigger has a hidden sizer (`.select-trigger-sizer`)
   whose `::after { content: <every-option-label> }` makes the button's
   intrinsic min-width = widest option. A long sheet name like
   "Pivot – Partner Member (Partner Certificate)" would then push the
   range input off-screen. `min-width: 0` lets the trigger shrink to our
   pinned width regardless of option contents. */
.pv-source-sheet { flex: 0 0 160px; width: 160px; min-width: 0; }

.pv-error { font-size: 12px; color: var(--ink-red-5); margin: 4px 0 0; }

/* ── Buckets ── */
.pv-buckets {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;
  margin-bottom: 20px;
}
.pv-bucket {
  border: 1px solid var(--outline-gray-2); border-radius: 8px; padding: 10px 10px 8px;
  min-height: 100px; display: flex; flex-direction: column;
}
.pv-bucket-label {
  font-size: 11px; font-weight: 600; color: var(--ink-gray-5);
  text-transform: uppercase; letter-spacing: .04em;
  display: flex; align-items: center; gap: 4px; margin: 0 0 8px;
}
.pv-bucket-icon { width: 12px; height: 12px; }

.pv-bucket-body { display: flex; flex-direction: column; gap: 4px; flex: 1; }

/* ── Field chips ── */
.pv-chip {
  display: flex; align-items: center; gap: 4px;
  background: var(--surface-gray-2); border-radius: 6px;
  padding: 3px 6px 3px 8px; font-size: 12px; color: var(--ink-gray-8);
}
.pv-chip--value { padding-left: 4px; }
.pv-chip-label  { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pv-chip-x {
  background: none; border: none; cursor: pointer; padding: 1px;
  display: flex; align-items: center; color: var(--ink-gray-4);
  border-radius: 3px; flex-shrink: 0;
}
.pv-chip-x:hover { background: var(--surface-gray-4); color: var(--ink-gray-7); }
.pv-chip-x-icon  { width: 11px; height: 11px; }

.pv-agg-btn {
  display: inline-flex; align-items: center; gap: 2px;
  background: var(--surface-gray-4); border: none; border-radius: 4px;
  padding: 1px 4px 1px 5px; font-size: 10px; font-weight: 700; color: var(--ink-gray-7);
  cursor: pointer; white-space: nowrap; flex-shrink: 0;
}
.pv-agg-btn:hover, .pv-agg-btn--open { background: var(--outline-gray-3); }
.pv-agg-chev { width: 10px; height: 10px; opacity: .65; }

.pv-add-btn { margin-top: 2px; }
.pv-add-btn :deep(button) { color: var(--ink-gray-5); font-size: 12px; }

/* ── Preview table ── */
.pv-preview-hint { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--ink-gray-4); }
.pv-preview-wrap {
  overflow-x: auto; border: 1px solid var(--outline-gray-2);
  border-radius: 8px; max-height: 200px; overflow-y: auto;
}
.pv-preview-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pv-th {
  background: var(--surface-gray-2); font-weight: 600; color: var(--ink-gray-7);
  padding: 6px 10px; text-align: left; white-space: nowrap;
  border-bottom: 1px solid var(--outline-gray-2); position: sticky; top: 0;
}
.pv-td {
  padding: 5px 10px; color: var(--ink-gray-8); border-bottom: 1px solid var(--outline-gray-1);
  white-space: nowrap;
}
.pv-td--num { text-align: right; font-variant-numeric: tabular-nums; }
.pv-total-row .pv-td { font-weight: 600; background: var(--surface-gray-1); }
</style>
