<template>
  <!-- frappe-ui Popover nests its layer inside the host Dialog's, so focus,
       clicks and Escape stay with the picker while it is open. -->
  <Popover v-model:open="open" bare>
    <template #trigger>
      <div class="pfp-wrap">
        <!-- Slot prop is `isOpen` (not `open`) to avoid colliding with the global
             `window.open` function name in some Vue template-compiler edge cases. -->
        <slot :is-open="open" />
      </div>
    </template>
    <div class="pfp-pop">
      <div class="pfp-search-row">
        <FeatherIcon name="search" class="pfp-search-icon" />
        <input
          ref="searchRef"
          name="pivot-field-search"
          v-model="query"
          class="pfp-search"
          placeholder="Search fields…"
          spellcheck="false"
          autocomplete="off"
          @keydown.enter.prevent="selectFirst"
          @keydown.down.prevent="moveHighlight(1)"
          @keydown.up.prevent="moveHighlight(-1)"
        />
      </div>
      <div class="pfp-list" ref="listRef">
        <button
          v-for="(f, i) in filtered"
          :key="f"
          class="pfp-item"
          :class="{ 'pfp-item--active': i === highlight }"
          @click="onSelect(f)"
          @mouseenter="highlight = i"
        >
          {{ f }}
        </button>
        <div v-if="!filtered.length" class="pfp-empty">No matching fields</div>
      </div>
    </div>
  </Popover>
</template>

<script setup>
import { Popover } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  fields: { type: Array, required: true },
})
const emit = defineEmits(['select', 'opened', 'closed'])

const open = ref(false)
const query = ref('')
const highlight = ref(0)
const searchRef = ref(null)
const listRef = ref(null)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.fields
  return props.fields.filter((f) => f.toLowerCase().includes(q))
})

watch(filtered, () => {
  highlight.value = 0
})

watch(open, (isOpen) => {
  if (!isOpen) {
    emit('closed')
    return
  }
  query.value = ''
  highlight.value = 0
  emit('opened')
  nextTick(() => searchRef.value?.focus({ preventScroll: true }))
})

function onSelect(f) {
  emit('select', f)
  open.value = false
}

function selectFirst() {
  const pick = filtered.value[highlight.value] ?? filtered.value[0]
  if (pick) onSelect(pick)
}

function moveHighlight(delta) {
  if (!filtered.value.length) return
  const n = filtered.value.length
  highlight.value = (highlight.value + delta + n) % n
  nextTick(() => {
    const el = listRef.value?.children[highlight.value]
    el?.scrollIntoView?.({ block: 'nearest' })
  })
}

// The dialog counts open pickers; a picker removed while open still closes.
onBeforeUnmount(() => {
  if (open.value) emit('closed')
})
</script>

<style scoped>
.pfp-wrap {
  display: block;
}

.pfp-pop {
  width: 240px;
  max-height: 195px;
  background: var(--surface-base, #ffffff);
  border: 1px solid var(--outline-gray-2, #e5e5e5);
  border-radius: 8px;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.03),
    0 8px 24px -6px rgba(0, 0, 0, 0.12),
    0 4px 8px -4px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pfp-search-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--outline-gray-2, #e5e5e5);
  flex-shrink: 0;
  background: var(--surface-base, #ffffff);
}
.pfp-search-icon {
  width: 13px;
  height: 13px;
  color: var(--ink-gray-4, #a3a3a3);
  flex-shrink: 0;
}
.pfp-search {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  border: 0;
  background: transparent;
  color: var(--ink-gray-9, #171717);
  padding: 0;
  /* !important + multi-state selectors are necessary because Frappe UI's
     global stylesheet adds a focus ring to every <input> by default; without
     this we get a harsh blue outline inside our pale popover. */
  outline: none !important;
  box-shadow: none !important;
}
.pfp-search::placeholder {
  color: var(--ink-gray-4, #a3a3a3);
}
.pfp-search:focus,
.pfp-search:focus-visible,
.pfp-search:active {
  outline: none !important;
  box-shadow: none !important;
  border-color: transparent !important;
}

.pfp-list {
  overflow-y: auto;
  padding: 4px;
  /* flex: 1 + min-height: 0 lets the list shrink when the popover container
     is shorter than the natural content (e.g. opened near the dialog edge).
     max-height caps the *expanded* state to 5 items so we never produce a
     250-row mega-popover for sheets with 100+ columns. Each item is
     ~28px (5+18+5) + 4px top padding ≈ 148px = 5 cleanly-visible rows. */
  flex: 1;
  min-height: 0;
  max-height: 148px;
}

.pfp-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 5px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ink-gray-8, #262626);
  font: inherit;
  font-size: 12.5px;
  line-height: 18px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background-color 0.08s ease;
}
.pfp-item:hover,
.pfp-item--active {
  background: var(--surface-gray-2, #f5f5f5);
  color: var(--ink-gray-9, #171717);
}

.pfp-empty {
  padding: 16px 10px;
  font-size: 12px;
  color: var(--ink-gray-5, #737373);
  text-align: center;
}

/* Thin, themed scrollbar — the system default is jarring against the
   popover's tight padding. */
.pfp-list::-webkit-scrollbar {
  width: 6px;
}
.pfp-list::-webkit-scrollbar-thumb {
  background: var(--outline-gray-3, #d4d4d4);
  border-radius: 3px;
}
.pfp-list::-webkit-scrollbar-thumb:hover {
  background: var(--outline-gray-4, #a3a3a3);
}
</style>
