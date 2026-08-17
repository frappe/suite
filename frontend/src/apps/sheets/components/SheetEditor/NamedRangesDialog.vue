<template>
  <Dialog v-model:open="show" title="Named ranges" size="lg">
    <template #default>

      <!-- ── Add new ────────────────────────────────────────────────────── -->
      <div class="nr-section">
        <p class="nr-label">{{ editing ? 'Edit named range' : 'Add named range' }}</p>
        <div class="nr-form">
          <FormControl
            v-model="form.name"
            type="text"
            label="Name"
            placeholder="e.g. Revenue"
            class="nr-form-input"
          />
          <FormControl
            type="select"
            label="Sheet"
            :model-value="form.sheet"
            :options="sheetOptions"
            @update:model-value="(v) => form.sheet = v"
            class="nr-form-sheet"
          />
          <FormControl
            v-model="form.range"
            type="text"
            label="Range"
            placeholder="e.g. B2:B100"
            class="nr-form-range"
          />
          <div class="nr-form-actions">
            <Button v-if="editing" @click="_resetForm">Cancel</Button>
            <Button variant="solid" :disabled="!_canSubmit" @click="_submit">
              {{ editing ? 'Save' : 'Add' }}
            </Button>
          </div>
        </div>
        <p v-if="formError" class="nr-error">{{ formError }}</p>
        <p class="nr-hint">
          Names must start with a letter or "_" and contain only letters, digits, and "_".
          They can't look like cell references or collide with built-in functions.
        </p>
      </div>

      <!-- ── Existing list ──────────────────────────────────────────────── -->
      <div class="nr-section">
        <p class="nr-label">Existing</p>
        <div v-if="!entries.length" class="nr-empty">No named ranges defined yet.</div>
        <div v-else class="nr-list">
          <div class="nr-row nr-row--head">
            <div>Name</div><div>Sheet</div><div>Range</div><div></div>
          </div>
          <div v-for="e in entries" :key="e.name" class="nr-row">
            <div class="nr-name"><code>{{ e.name }}</code></div>
            <div class="nr-sheet">{{ e.sheet || '(current)' }}</div>
            <div class="nr-range"><code>{{ e.range }}</code></div>
            <div class="nr-row-actions">
              <Button size="sm" variant="ghost" icon="lucide-edit-2"  @click="_edit(e)"  tooltip="Edit"   />
              <Button size="sm" variant="ghost" icon="lucide-trash-2" @click="_delete(e)" theme="red" tooltip="Delete" />
            </div>
          </div>
        </div>
      </div>

    </template>

    <template #actions>
      <div class="flex flex-row-reverse gap-2">
        <Button variant="solid" @click="show = false">Done</Button>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref, reactive, watch } from 'vue'
import { Button, Dialog, FormControl } from 'frappe-ui'

const props = defineProps({
  modelValue:    { type: Boolean, default: false },
  namedRanges:   { type: Object,  required: true },   // engine instance
  sheetNames:    { type: Array,   default: () => [] },
  currentSheet:  { type: String,  default: '' },
})
const emit = defineEmits(['update:modelValue', 'changed'])

const show = computed({
  get: () => props.modelValue,
  set: v  => emit('update:modelValue', v),
})

// Local reactive mirror so the dialog updates when the engine mutates.
const _version = ref(0)
props.namedRanges.setOnChange?.(() => { _version.value++ })

const entries = computed(() => {
  void _version.value
  return [...props.namedRanges.list()].sort((a, b) => a.name.localeCompare(b.name))
})

const sheetOptions = computed(() => {
  const opts = props.sheetNames.map(n => ({ label: n, value: n }))
  // First entry represents "current sheet" (empty string) — Sheets behaviour
  // for names with no explicit sheet binding.
  return [{ label: '(current)', value: '' }, ...opts]
})

// ── Form state ─────────────────────────────────────────────────────────────

const editing  = ref(null)            // null = add mode; otherwise old entry name
const form     = reactive({ name: '', sheet: '', range: '' })
const formError = ref('')

watch(show, (open) => {
  if (open) {
    _resetForm()
  }
})

const _canSubmit = computed(() =>
  form.name.trim().length > 0 && form.range.trim().length > 0)

function _resetForm() {
  editing.value  = null
  form.name      = ''
  form.sheet     = props.currentSheet || ''
  form.range     = ''
  formError.value = ''
}

function _edit(e) {
  editing.value = e.name
  form.name     = e.name
  form.sheet    = e.sheet || ''
  form.range    = e.range
  formError.value = ''
}

function _delete(e) {
  // eslint-disable-next-line no-alert
  if (!window.confirm(`Delete named range "${e.name}"?`)) return
  props.namedRanges.remove(e.name)
  emit('changed')
}

function _submit() {
  const payload = { name: form.name.trim(), sheet: form.sheet || '', range: form.range.trim() }
  let result
  if (editing.value) {
    result = props.namedRanges.update(editing.value, payload)
  } else {
    result = props.namedRanges.add(payload)
  }
  if (result?.error) {
    formError.value = result.error
    return
  }
  emit('changed')
  _resetForm()
}
</script>

<style scoped>
.nr-section { margin-bottom: 20px; }
.nr-label   { font-size: 11px; font-weight: 600; color: var(--ink-gray-6); text-transform: uppercase; letter-spacing: .04em; margin: 0 0 6px; }
.nr-hint    { font-size: 12px; color: var(--ink-gray-5); margin: 8px 0 0; line-height: 1.5; }
.nr-error   { font-size: 12px; color: var(--ink-red-5); margin: 8px 0 0; }
.nr-empty   { font-size: 13px; color: var(--ink-gray-5); padding: 16px; text-align: center; background: var(--surface-gray-1); border-radius: 8px; }

.nr-form {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr auto;
  gap: 10px;
  align-items: end;
}
.nr-form-actions {
  display: flex; gap: 6px;
}

.nr-list {
  border: 1px solid var(--outline-gray-2);
  border-radius: 8px;
  overflow: hidden;
}
.nr-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--outline-gray-2);
  font-size: 13px;
  color: var(--ink-gray-8);
}
.nr-row:last-child { border-bottom: 0; }
.nr-row--head {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-gray-5);
  text-transform: uppercase;
  letter-spacing: .04em;
  background: var(--surface-gray-1);
}
.nr-name code, .nr-range code {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12.5px;
  color: var(--ink-gray-9);
}
.nr-sheet { color: var(--ink-gray-7); }
.nr-row-actions { display: flex; gap: 4px; justify-content: flex-end; }
</style>
