<template>
  <Dialog v-model:open="validationDialog.open" title="Data validation" size="sm">
    <template #default>
      <div class="sn-form-stack">
        <!-- Type -->
        <FormControl
          v-model="validationDialog.type"
          type="select"
          label="Type"
          :options="[
            { label: 'Checkbox', value: 'checkbox' },
            { label: 'List of items', value: 'list' },
            { label: 'Number', value: 'number' },
            { label: 'Text length', value: 'text_length' },
          ]"
        />

        <!-- List — one row per item: a colour swatch, the label, and remove.
           Paste a comma/newline list into any field to split it into rows. -->
        <div v-if="validationDialog.type === 'list'" ref="vdListEl" class="sn-vd-list">
          <label class="sn-vd-list-label">Items</label>
          <div v-for="(item, i) in validationDialog.listItems" :key="i" class="sn-vd-item">
            <ColorPicker
              :model-value="item.color || ''"
              allow-default
              default-label="Automatic colour"
              :fallback="autoChipColor(i)"
              title="Label colour"
              @update:model-value="item.color = $event"
            >
              <template #trigger="{ toggle, open }">
                <button
                  type="button"
                  class="sn-vd-swatch"
                  :class="{ 'is-open': open }"
                  :style="{ background: item.color || autoChipColor(i) }"
                  title="Label colour"
                  @click="toggle()"
                />
              </template>
            </ColorPicker>
            <input
              v-model="item.label"
              class="sn-vd-item-input"
              placeholder="Item"
              @keydown.enter.prevent="addListItem(i)"
              @paste="onListPaste($event, i)"
            />
            <button
              type="button"
              class="sn-vd-item-x"
              title="Remove item"
              @click="removeListItem(i)"
            >
              <FeatherIcon name="x" class="sn-vd-item-xg" />
            </button>
          </div>
          <button type="button" class="sn-vd-add" @click="addListItem()">
            <FeatherIcon name="plus" class="sn-vd-add-g" /> Add item
          </button>
        </div>

        <!-- Operator (number / text_length) -->
        <FormControl
          v-if="['number', 'text_length'].includes(validationDialog.type)"
          v-model="validationDialog.operator"
          type="select"
          label="Condition"
          :options="[
            { label: 'Between', value: 'between' },
            { label: 'Not between', value: 'not_between' },
            { label: 'Greater than', value: 'gt' },
            { label: 'Greater than or equal', value: 'gte' },
            { label: 'Less than', value: 'lt' },
            { label: 'Less than or equal', value: 'lte' },
            { label: 'Equal to', value: 'eq' },
            { label: 'Not equal to', value: 'neq' },
          ]"
        />

        <!-- Values -->
        <div v-if="['number', 'text_length'].includes(validationDialog.type)" class="sn-vd-vals">
          <FormControl
            v-model="validationDialog.val1"
            type="number"
            :label="
              ['between', 'not_between'].includes(validationDialog.operator) ? 'Min' : 'Value'
            "
          />
          <FormControl
            v-if="['between', 'not_between'].includes(validationDialog.operator)"
            v-model="validationDialog.val2"
            type="number"
            label="Max"
          />
        </div>

        <p v-if="missing" class="sn-vd-missing">{{ missing }}</p>

        <!-- Custom error message -->
        <FormControl
          v-model="validationDialog.message"
          label="Error message (optional)"
          placeholder="This value is not allowed"
        />

        <!-- On invalid: block the edit, or allow it with a warning -->
        <FormControl
          v-if="validationDialog.type !== 'checkbox'"
          v-model="validationDialog.severity"
          type="select"
          label="When the value is invalid"
          :options="[
            { label: 'Reject the input', value: 'reject' },
            { label: 'Allow, but show a warning', value: 'warn' },
          ]"
        />
      </div>
    </template>
    <template #actions>
      <div class="flex flex-row-reverse gap-2">
        <Button variant="solid" :disabled="Boolean(missing)" @click="confirmValidation">
          Apply
        </Button>
        <Button variant="ghost" theme="red" @click="removeValidation">Remove rule</Button>
        <Button @click="validationDialog.open = false">Cancel</Button>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { computed, nextTick, reactive, ref } from 'vue'

import { translate as __ } from '@/platform/translation'

import { chipPaletteColor } from '../../canvas/chip-geometry'
import ColorPicker from './ColorPicker.vue'

// The data-validation dialog: edits one rule as a form. The editor opens it
// with open(rule) (the active cell's rule, or null) and applies the result to
// the selection on `apply`, or clears the selection's rules on `remove`.

/** A rule as `engine/validation.js` stores it. */
export interface ValidationRule {
  type: string
  options?: string[]
  colors?: Record<string, string>
  operator?: string
  min?: number | undefined
  max?: number | undefined
  message?: string | undefined
  severity?: string | undefined
}

interface ListItem {
  label: string
  color: string
}

const emit = defineEmits<{ apply: [rule: ValidationRule]; remove: [] }>()

const vdListEl = ref<HTMLElement | null>(null)
const validationDialog = reactive({
  open: false,
  type: 'list',
  // 'list' | 'number' | 'text_length'
  operator: 'between',
  // 'between' | 'not_between' | 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'
  val1: '',
  val2: '',
  listItems: [] as ListItem[],
  // [{ label, color }] — color '' means auto (palette by position)
  message: '',
  severity: 'reject', // 'reject' blocks the edit; 'warn' allows it but flags the cell
})

function openRule(e: ValidationRule | null) {
  validationDialog.type = e?.type || 'list'
  validationDialog.operator = e?.operator || 'between'
  validationDialog.val1 = String(e?.min ?? '')
  validationDialog.val2 = String(e?.max ?? '')
  const opts = e?.options || []
  const colors = e?.colors || {}
  validationDialog.listItems = opts.length
    ? opts.map((o) => ({
        label: o,
        color: colors[o] || '',
      }))
    : [
        {
          label: '',
          color: '',
        },
      ] // start with one empty row to type into
  validationDialog.message = e?.message || ''
  validationDialog.severity = e?.severity || 'reject'
  validationDialog.open = true
}
defineExpose({ open: openRule })

// The auto (unset) chip colour for the item at position `i` — matches how the
// painter slots colours by option order, so the dialog previews the real thing.
function autoChipColor(i: number): string {
  return chipPaletteColor(i)
}
function addListItem(afterIdx?: number) {
  const row = {
    label: '',
    color: '',
  }
  if (afterIdx == null) validationDialog.listItems.push(row)
  else validationDialog.listItems.splice(afterIdx + 1, 0, row)
  focusListItem(afterIdx == null ? validationDialog.listItems.length - 1 : afterIdx + 1)
}
function removeListItem(i: number) {
  validationDialog.listItems.splice(i, 1)
  if (!validationDialog.listItems.length)
    validationDialog.listItems.push({
      label: '',
      color: '',
    })
}

// Paste a comma/newline-separated list into a row → split it across rows, so
// bulk entry ("Yes, No, Maybe") still works alongside per-item editing.
function onListPaste(ev: ClipboardEvent, i: number) {
  const text = ev.clipboardData?.getData('text') || ''
  if (!/[,\n]/.test(text)) return // single value → let the default paste happen
  ev.preventDefault()
  const parts = text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const item = validationDialog.listItems[i]
  if (!parts.length || !item) return
  item.label = parts[0] ?? ''
  validationDialog.listItems.splice(
    i + 1,
    0,
    ...parts.slice(1).map((label) => ({
      label,
      color: '',
    })),
  )
}
async function focusListItem(i: number) {
  await nextTick()
  vdListEl.value?.querySelectorAll<HTMLInputElement>('.sn-vd-item-input')?.[i]?.focus()
}

// The form as a rule.
function buildRule(): ValidationRule {
  const msg = validationDialog.message.trim() || undefined
  // 'warn' only differs from the default when the value fails, and a checkbox
  // is TRUE/FALSE-only where "allow anyway" makes no sense — so scope it out.
  const severity =
    validationDialog.type === 'checkbox'
      ? undefined
      : validationDialog.severity === 'warn'
        ? 'warn'
        : undefined
  if (validationDialog.type === 'checkbox') {
    return {
      type: 'checkbox',
      message: msg,
    }
  }
  if (validationDialog.type === 'list') {
    // De-dupe by label (first wins), keeping only rows that have a colour set.
    const options: string[] = []
    const colors: Record<string, string> = {}
    for (const it of validationDialog.listItems) {
      const label = it.label.trim()
      if (!label || options.includes(label)) continue
      options.push(label)
      if (it.color) colors[label] = it.color
    }
    const rule: ValidationRule = {
      type: 'list',
      options,
      message: msg,
      severity,
    }
    if (Object.keys(colors).length) rule.colors = colors
    return rule
  }
  const op = validationDialog.operator
  const v1 = parseFloat(validationDialog.val1)
  const v2 = parseFloat(validationDialog.val2)
  const min = isNaN(v1) ? undefined : v1
  const max = ['between', 'not_between'].includes(op) && !isNaN(v2) ? v2 : undefined
  return {
    type: validationDialog.type,
    operator: op,
    min,
    max,
    message: msg,
    severity,
  }
}
// What the form still needs before it can be applied, or '' when complete.
// A rule saved without its value(s) rejected, or accepted, every input
// (ISSUES #26), so Apply waits for them, as in Google Sheets.
const missing = computed(() => {
  const { type, operator, val1, val2 } = validationDialog
  if (type === 'list') {
    return validationDialog.listItems.some((it) => it.label.trim())
      ? ''
      : __('Add at least one item.')
  }
  if (type !== 'number' && type !== 'text_length') return ''
  const filled = (v: string) => !isNaN(parseFloat(v))
  if (['between', 'not_between'].includes(operator)) {
    return filled(val1) && filled(val2) ? '' : __('Enter both Min and Max.')
  }
  return filled(val1) ? '' : __('Enter a value.')
})

function confirmValidation() {
  if (missing.value) return
  const rule = buildRule()
  validationDialog.open = false
  emit('apply', rule)
}
function removeValidation() {
  validationDialog.open = false
  emit('remove')
}
</script>

<style scoped>
/* Dialog form rows, as in SheetEditor.css. */
.sn-form-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Validation dialog two-column value row */
.sn-vd-vals {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

/* Why Apply is disabled */
.sn-vd-missing {
  margin: 0;
  font-size: 12px;
  color: var(--ink-gray-5);
}

/* Validation "List of items" per-item editor: swatch · label · remove */
.sn-vd-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sn-vd-list-label {
  font-size: 12px;
  color: var(--ink-gray-5);
}
.sn-vd-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sn-vd-swatch {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--outline-gray-2);
  cursor: pointer;
  padding: 0;
}
.sn-vd-swatch:hover,
.sn-vd-swatch.is-open {
  box-shadow:
    0 0 0 2px var(--surface-base),
    0 0 0 3.5px var(--outline-gray-4);
}
.sn-vd-item-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  font-size: 13px;
  border: 1px solid var(--outline-gray-2);
  border-radius: 8px;
  color: var(--ink-gray-9);
  background: var(--surface-base);
  outline: none;
}
.sn-vd-item-input:focus {
  border-color: var(--outline-gray-4);
}
.sn-vd-item-x {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--ink-gray-5);
  cursor: pointer;
}
.sn-vd-item-x:hover {
  background: var(--surface-gray-2);
  color: var(--ink-gray-8);
}
.sn-vd-item-xg {
  width: 15px;
  height: 15px;
}
.sn-vd-add {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  padding: 4px 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-gray-7);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.sn-vd-add:hover {
  background: var(--surface-gray-2);
  color: var(--ink-gray-9);
}
.sn-vd-add-g {
  width: 14px;
  height: 14px;
}
</style>
