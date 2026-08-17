<template>
  <div class="pfp-wrap">
    <div ref="triggerRef" @click="toggle">
      <!-- Slot prop is `isOpen` (not `open`) to avoid colliding with the global
           `window.open` function name in some Vue template-compiler edge cases.
           Pass the unwrapped boolean explicitly. -->
      <slot :is-open="open" />
    </div>
    <!-- Teleport into Frappe UI Dialog's `.dialog-overlay` (its `fixed inset-0`
         outer wrapper, *not* the `DialogContent` panel which has both
         `transform` and `overflow-hidden`). This puts the popover INSIDE the
         dialog's interactive boundary (focus trap, click semantics, inert
         siblings all work) while escaping the panel's clip box, so the
         popover can extend past the dialog edge without being cut off. -->
    <Teleport :to="teleportTarget" :disabled="!open">
      <!-- Wrap in Reka UI's FocusScope so its global stack auto-pauses the
           host Dialog's focus trap while the popover is open. Without this,
           the Dialog's FocusScope (listening on document.focusin/out) steals
           focus from the teleported search input on every keystroke and
           typing does nothing. `as-child` reuses our div as the scope
           container; `trapped=false` is fine — we only want the *pause*
           side-effect, not our own trap. -->
      <FocusScope v-if="open" as-child :trapped="false">
      <div
        ref="popRef"
        class="pfp-pop"
        :class="{ 'pfp-pop--up': openUpward }"
        :style="popStyle"
      >
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
            @keydown.escape.stop="close"
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
          >{{ f }}</button>
          <div v-if="!filtered.length" class="pfp-empty">No matching fields</div>
        </div>
      </div>
      </FocusScope>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { FocusScope } from 'reka-ui'

const props = defineProps({
  fields: { type: Array, required: true },
})
const emit = defineEmits(['select', 'opened', 'closed'])

const open           = ref(false)
const query          = ref('')
const highlight      = ref(0)
const openUpward     = ref(false)
const triggerRef     = ref(null)
const popRef         = ref(null)
const searchRef      = ref(null)
const listRef        = ref(null)
const popStyle       = ref({})
// Resolved at open time so the popover lands inside the host dialog's
// outer overlay (HeadlessUI interactive zone) rather than naked <body>.
const teleportTarget = ref('body')

// Approximate popover height — 1 search row (~36px) + 1px border + list cap
// (148px) + popover padding. Used for both the open-up/down decision and the
// initial space-fits check before measurement.
const POP_H = 195

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.fields
  return props.fields.filter(f => f.toLowerCase().includes(q))
})

watch(filtered, () => { highlight.value = 0 })

function toggle() { open.value ? close() : openPopover() }

async function openPopover() {
  query.value     = ''
  highlight.value = 0
  // Resolve the teleport target before opening — walk up from the trigger to
  // find any host that's a Frappe UI Dialog overlay (no transform, no clip
  // box). Fall back to <body> for non-dialog contexts so the component
  // remains usable outside dialogs.
  teleportTarget.value = _findOverlayHost() || 'body'
  open.value = true
  emit('opened')
  await nextTick()
  _position()
  // preventScroll: true keeps the dialog from autoscrolling and shifting
  // the trigger's viewport coordinates under us.
  requestAnimationFrame(() => { searchRef.value?.focus({ preventScroll: true }) })
  document.addEventListener('mousedown', _onOutsideClick, true)
  document.addEventListener('keydown',   _onGlobalKey,    true)
  window.addEventListener('resize', _position)
  window.addEventListener('scroll', _onScroll, true)
}

function close() {
  if (!open.value) return
  open.value = false
  emit('closed')
  document.removeEventListener('mousedown', _onOutsideClick, true)
  document.removeEventListener('keydown',   _onGlobalKey,    true)
  window.removeEventListener('resize', _position)
  window.removeEventListener('scroll', _onScroll, true)
}

let _scrollRafId = 0
function _onScroll() {
  if (_scrollRafId) return
  _scrollRafId = requestAnimationFrame(() => { _scrollRafId = 0; _position() })
}

function onSelect(f) {
  emit('select', f)
  close()
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

// Compute popover position in viewport coordinates. Since the popover is
// teleported into `.dialog-overlay` (a `fixed inset-0` element with no
// transform), `position: fixed` here behaves normally — coordinates are
// relative to the viewport.
function _position() {
  const t = triggerRef.value?.getBoundingClientRect()
  if (!t) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const pad = 8
  const width = Math.max(180, Math.min(280, t.width))
  const spaceBelow = vh - t.bottom
  const spaceAbove = t.top
  const up = spaceBelow < POP_H && spaceAbove > spaceBelow
  openUpward.value = up
  const maxH = Math.max(140, Math.min(POP_H, (up ? spaceAbove : spaceBelow) - pad))
  const left = Math.min(Math.max(pad, t.left), vw - width - pad)
  popStyle.value = up
    ? { left: `${left}px`, bottom: `${vh - t.top + 6}px`, width: `${width}px`, maxHeight: `${maxH}px` }
    : { left: `${left}px`, top:    `${t.bottom + 6}px`,    width: `${width}px`, maxHeight: `${maxH}px` }
}

// Walk up from the trigger to find a Frappe UI Dialog overlay container.
// `.dialog-overlay` is the `fixed inset-0` element that wraps the panel —
// no transform, no overflow:hidden — so teleporting there lets the popover
// escape the inner panel's clip box without leaving HeadlessUI's interactive
// zone (which is what kills clicks/focus when we teleport to bare <body>).
function _findOverlayHost() {
  let node = triggerRef.value?.parentElement
  while (node && node !== document.body) {
    if (node.classList?.contains('dialog-overlay')) return node
    node = node.parentElement
  }
  // Not inside a dialog — fall through to <body> at the caller.
  return null
}

function _onOutsideClick(e) {
  if (popRef.value?.contains(e.target))     return
  if (triggerRef.value?.contains(e.target)) return
  close()
}

function _onGlobalKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); close() }
}

onBeforeUnmount(close)
</script>

<style scoped>
.pfp-wrap {
  position: relative;
  display: block;
}

.pfp-pop {
  /* Teleported to <body>, so positioned via inline `left/top/bottom/width`
     from _position(). z-index sits above Frappe UI Dialog (~50-100) but
     below modal-blocking layers like global toasts. */
  position: fixed;
  z-index: 9500;
  background: var(--surface-base, #ffffff);
  border: 1px solid var(--outline-gray-2, #e5e5e5);
  border-radius: 8px;
  box-shadow:
    0 0 0 1px rgba(0,0,0,.03),
    0 8px 24px -6px rgba(0,0,0,.12),
    0 4px 8px -4px rgba(0,0,0,.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: pfp-rise 140ms cubic-bezier(.2,.8,.25,1);
  transform-origin: top left;
}
.pfp-pop--up {
  transform-origin: bottom left;
}
@keyframes pfp-rise {
  from { transform: translateY(-4px) scale(.98); opacity: 0; }
  to   { transform: translateY(0)    scale(1);   opacity: 1; }
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
.pfp-search-icon { width: 13px; height: 13px; color: var(--ink-gray-4, #a3a3a3); flex-shrink: 0; }
.pfp-search {
  flex: 1; min-width: 0;
  font: inherit; font-size: 13px; line-height: 18px;
  border: 0; background: transparent;
  color: var(--ink-gray-9, #171717);
  padding: 0;
  /* !important + multi-state selectors are necessary because Frappe UI's
     global stylesheet adds a focus ring to every <input> by default; without
     this we get a harsh blue outline inside our pale popover. */
  outline: none !important;
  box-shadow: none !important;
}
.pfp-search::placeholder { color: var(--ink-gray-4, #a3a3a3); }
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
  display: block; width: 100%; text-align: left;
  padding: 5px 8px; border: 0; border-radius: 4px;
  background: transparent; color: var(--ink-gray-8, #262626);
  font: inherit; font-size: 12.5px; line-height: 18px;
  cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: background-color .08s ease;
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
.pfp-list::-webkit-scrollbar { width: 6px; }
.pfp-list::-webkit-scrollbar-thumb {
  background: var(--outline-gray-3, #d4d4d4);
  border-radius: 3px;
}
.pfp-list::-webkit-scrollbar-thumb:hover { background: var(--outline-gray-4, #a3a3a3); }
</style>
