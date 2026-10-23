<template>
  <div ref="panelRef" class="fr-panel">
    <div class="fr-header">
      <span class="fr-title">Find &amp; Replace</span>
      <Button
        variant="ghost"
        size="sm"
        icon="lucide-x"
        aria-label="Close find and replace"
        @click="emit('close')"
      />
    </div>
    <FormControl
      v-model="findQuery"
      type="text"
      size="sm"
      placeholder="Find"
      autocomplete="off"
      @keydown.enter="findNext"
      @keydown.escape="emit('close')"
    />
    <FormControl
      v-model="replaceQuery"
      type="text"
      size="sm"
      placeholder="Replace with"
      autocomplete="off"
    />
    <div class="fr-actions">
      <Button class="fr-grow" variant="solid" size="sm" label="Find next" @click="findNext" />
      <Button class="fr-grow" variant="outline" size="sm" label="Replace" @click="replaceCurrent" />
      <Button class="fr-grow" variant="outline" size="sm" label="All" @click="replaceAll" />
    </div>
    <div v-if="status" class="fr-status">{{ status }}</div>
  </div>
</template>

<script setup>
import { Button, FormControl } from 'frappe-ui'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  sheet: { type: String, required: true },
  // (query, sheet) => Promise<{ id, input }[]> — cells whose input contains query.
  find: { type: Function, required: true },
  // (ids, sheet) => Promise<{cellId: input}> — fresh inputs for replacement and undo.
  read: { type: Function, required: true },
  // (before, after, sheet) — write {cellId: input} replacements as one edit.
  write: { type: Function, required: true },
  // (id) => boolean — true when a cell is protected and must not be rewritten.
  isProtected: { type: Function, default: null },
})
const emit = defineEmits(['close', 'navigateTo'])

const findQuery = ref('')
const replaceQuery = ref('')
const matches = ref([]) // [{ id, input }] in reading order
const matchIndex = ref(-1)
const status = ref('')
const panelRef = ref(null)

function focusInput() {
  const doFocus = () => {
    const input = panelRef.value?.querySelector('input')
    if (input && typeof input.focus === 'function') {
      input.focus()
      if (typeof input.select === 'function') {
        input.select()
      }
    }
  }
  nextTick(doFocus)
  setTimeout(doFocus, 0)
  setTimeout(doFocus, 50)
}

onMounted(() => {
  focusInput()
})

defineExpose({
  focusInput,
})

// Results and pending replacements belong to one sheet and query.
let _search = 0
onBeforeUnmount(() => _search++)

async function _buildMatches() {
  const q = findQuery.value
  const sheet = props.sheet
  const mine = ++_search
  const found = q ? await props.find(q, sheet) : []
  if (mine !== _search) return false
  matches.value = found
  matchIndex.value = found.length ? 0 : -1
  status.value = !q ? '' : found.length ? `1 of ${found.length}` : 'No matches'
  return true
}

watch(
  [findQuery, () => props.sheet],
  async () => {
    matches.value = []
    matchIndex.value = -1
    status.value = ''
    if ((await _buildMatches()) && matches.value.length) emit('navigateTo', matches.value[0].id)
  },
  { flush: 'sync' },
)

async function findNext() {
  if (!matches.value.length) {
    if (!(await _buildMatches())) return
    if (!matches.value.length) return
  }
  matchIndex.value = (matchIndex.value + 1) % matches.value.length
  status.value = `${matchIndex.value + 1} of ${matches.value.length}`
  emit('navigateTo', matches.value[matchIndex.value].id)
}

// The input with every case-insensitive occurrence of the query replaced.
function _replaced(input) {
  const pattern = new RegExp(findQuery.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  return input.replace(pattern, () => replaceQuery.value)
}

async function replaceCurrent() {
  const m = matches.value[matchIndex.value]
  if (!m) return
  const sheet = props.sheet
  const mine = _search
  const inputs = await props.read([m.id], sheet)
  if (mine !== _search || sheet !== props.sheet) return
  const input = inputs[m.id] ?? ''
  if (!input.toLowerCase().includes(findQuery.value.toLowerCase())) {
    await _buildMatches()
    return
  }
  if (props.isProtected?.(m.id)) {
    status.value = 'Cell is protected'
    return
  }
  props.write({ [m.id]: input }, { [m.id]: _replaced(input) }, sheet)
  await _buildMatches()
}

async function replaceAll() {
  if (!findQuery.value) return
  if (!(await _buildMatches())) return
  const sheet = props.sheet
  const mine = _search
  const found = matches.value
  const inputs = await props.read(
    found.map((m) => m.id),
    sheet,
  )
  if (mine !== _search || sheet !== props.sheet) return
  const before = {}
  const after = {}
  let skipped = 0
  for (const m of found) {
    const input = inputs[m.id] ?? ''
    if (!input.toLowerCase().includes(findQuery.value.toLowerCase())) continue
    if (props.isProtected?.(m.id)) {
      skipped++ // leave protected cells untouched
      continue
    }
    before[m.id] = input
    after[m.id] = _replaced(input)
  }
  const count = Object.keys(after).length
  if (count) props.write(before, after, sheet)
  if (!(await _buildMatches())) return
  status.value = skipped
    ? `Replaced ${count} cell(s), skipped ${skipped} protected`
    : `Replaced ${count} cell(s)`
}
</script>

<style scoped>
.fr-panel {
  position: fixed;
  top: 60px;
  right: 16px;
  z-index: 200;
  background: var(--surface-elevation-2);
  border: 1px solid var(--outline-elevation-2);
  border-radius: 10px;
  box-shadow:
    0 0 1px rgba(0, 0, 0, 0.35),
    0 6px 8px -4px rgba(0, 0, 0, 0.1);
  padding: 12px;
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fr-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.fr-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--ink-gray-9);
}
.fr-actions {
  display: flex;
  gap: 4px;
  padding-top: 2px;
}
.fr-grow {
  flex: 1;
}
.fr-status {
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--ink-gray-5);
  text-align: center;
  padding-top: 2px;
}
</style>
