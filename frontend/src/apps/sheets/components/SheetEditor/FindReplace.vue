<template>
  <div class="fr-panel" ref="panelRef">
    <div class="fr-header">
      <span class="fr-title">Find &amp; Replace</span>
      <Button variant="ghost" size="sm" icon="lucide-x" @click="emit('close')" />
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
      <Button class="fr-grow" variant="solid"   size="sm" label="Find next" @click="findNext" />
      <Button class="fr-grow" variant="outline" size="sm" label="Replace"   @click="replaceCurrent" />
      <Button class="fr-grow" variant="outline" size="sm" label="All"       @click="replaceAll" />
    </div>
    <div v-if="status" class="fr-status">{{ status }}</div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'
import { Button, FormControl } from 'frappe-ui'

const props = defineProps({
  sheet: { type: Object, required: true },
  grid:  { type: Object, required: true },
  // (id) => boolean — true when a cell is protected and must not be rewritten.
  isProtected: { type: Function, default: null },
})
const emit = defineEmits(['close', 'navigateTo'])

const findQuery    = ref('')
const replaceQuery = ref('')
const matches      = ref([])
const matchIndex   = ref(-1)
const status       = ref('')
const panelRef     = ref(null)

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

function _buildMatches() {
  const q = findQuery.value.toLowerCase()
  if (!q) { matches.value = []; matchIndex.value = -1; status.value = ''; return }
  const data = props.sheet.getRawData()
  const found = []
  for (const [id, val] of Object.entries(data)) {
    if (String(val).toLowerCase().includes(q)) found.push(id)
  }
  matches.value  = found
  matchIndex.value = found.length ? 0 : -1
  status.value = found.length ? `1 of ${found.length}` : 'No matches'
}

watch(findQuery, () => {
  _buildMatches()
  if (matches.value.length) emit('navigateTo', matches.value[0])
})

function findNext() {
  if (!matches.value.length) { _buildMatches(); if (!matches.value.length) return }
  matchIndex.value = (matchIndex.value + 1) % matches.value.length
  status.value = `${matchIndex.value + 1} of ${matches.value.length}`
  emit('navigateTo', matches.value[matchIndex.value])
}

function replaceCurrent() {
  if (matchIndex.value < 0 || !matches.value.length) return
  const id  = matches.value[matchIndex.value]
  if (props.isProtected?.(id)) { status.value = 'Cell is protected'; return }
  const cur = String(props.sheet.getCell(id))
  const q   = findQuery.value
  props.sheet.setCell(id, cur.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replaceQuery.value))
  _buildMatches()
}

function replaceAll() {
  const q = findQuery.value
  if (!q) return
  _buildMatches()
  let count = 0, skipped = 0
  for (const id of matches.value) {
    if (props.isProtected?.(id)) { skipped++; continue }   // leave protected cells untouched
    const cur = String(props.sheet.getCell(id))
    props.sheet.setCell(id, cur.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replaceQuery.value))
    count++
  }
  status.value = skipped
    ? `Replaced ${count} cell(s), skipped ${skipped} protected`
    : `Replaced ${count} cell(s)`
  _buildMatches()
}
</script>

<style scoped>
.fr-panel   { position:fixed; top:60px; right:16px; z-index:200; background:var(--surface-elevation-2); border:1px solid var(--outline-elevation-2); border-radius:10px; box-shadow:0 0 1px rgba(0,0,0,.35), 0 6px 8px -4px rgba(0,0,0,.1); padding:12px; width:280px; display:flex; flex-direction:column; gap:8px; }
.fr-header  { display:flex; justify-content:space-between; align-items:center; }
.fr-title   { font-size:13px; font-weight:600; letter-spacing:.02em; color:var(--ink-gray-9); }
.fr-actions { display:flex; gap:4px; padding-top:2px; }
.fr-grow    { flex:1; }
.fr-status  { font-size:11px; letter-spacing:.02em; color:var(--ink-gray-5); text-align:center; padding-top:2px; }
</style>
