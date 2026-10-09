<template>
  <div class="fr-panel" ref="panelRef">
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
      type="text"
      size="sm"
      v-model="findQuery"
      placeholder="Find"
      autocomplete="off"
      @keydown.enter="findNext"
      @keydown.escape="emit('close')"
    />
    <FormControl
      type="text"
      size="sm"
      v-model="replaceQuery"
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
import { nextTick, onMounted, ref, watch } from 'vue'

const props = defineProps({
  // (query) => Promise<{ id, input }[]> — cells whose input contains query.
  find: { type: Function, required: true },
  // (before, after) — write {cellId: input} replacements as one edit.
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

// Only the newest search may set the results; typing fires one per key.
let _search = 0

async function _buildMatches() {
  const q = findQuery.value
  const mine = ++_search
  const found = q ? await props.find(q) : []
  if (mine !== _search) return false
  matches.value = found
  matchIndex.value = found.length ? 0 : -1
  status.value = !q ? '' : found.length ? `1 of ${found.length}` : 'No matches'
  return true
}

watch(findQuery, async () => {
  if ((await _buildMatches()) && matches.value.length) emit('navigateTo', matches.value[0].id)
})

async function findNext() {
  if (!matches.value.length) {
    await _buildMatches()
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
  if (props.isProtected?.(m.id)) {
    status.value = 'Cell is protected'
    return
  }
  props.write({ [m.id]: m.input }, { [m.id]: _replaced(m.input) })
  await _buildMatches()
}

async function replaceAll() {
  if (!findQuery.value) return
  await _buildMatches()
  const before = {}
  const after = {}
  let skipped = 0
  for (const m of matches.value) {
    if (props.isProtected?.(m.id)) {
      skipped++ // leave protected cells untouched
      continue
    }
    before[m.id] = m.input
    after[m.id] = _replaced(m.input)
  }
  const count = Object.keys(after).length
  if (count) props.write(before, after)
  await _buildMatches()
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
