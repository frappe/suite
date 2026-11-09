<template>
  <!-- Bottom bar: add sheet, the sheet tabs (right-click for the tab menu, drag to
  reorder, double-click to rename, peer dots) and the selection's Count / Sum / Avg. -->
  <div class="sn-bottom">
    <!-- Pinned outside the scroll track so it stays reachable no matter how
       many tabs there are. Add-sheet is a mutation, so viewers don't get it. -->
    <div v-if="!readOnly" class="sn-tab-add-wrap">
      <Button
        aria-label="Add sheet"
        variant="ghost"
        size="sm"
        icon="lucide-plus"
        class="sn-tab-add"
        tooltip="Add sheet"
        @click="emit('add-sheet')"
      />
    </div>
    <div class="sn-tabs-track">
      <!-- Sheets switch on click, so Tabs' own update:model-value is left
         unused: it fires on mousedown, before the blur that commits an open
         cell edit, and switchSheet clears the grid. -->
      <Tabs :key="orderVersion" :model-value="currentSheet">
        <TabList variant="ghost" size="sm">
          <template v-for="name in sheetNames" :key="name">
            <span
              v-if="tabDragOver === name && tabDragName !== name"
              class="sn-tab-drop-mark"
              aria-hidden="true"
            />
            <!-- One cell: the trigger sizes it to the name, and the field lies
               exactly over the trigger. No position of its own, as the sliding
               highlight measures tabs against the list. -->
            <span
              class="sn-tab-cell"
              :class="{
                'sn-tab-cell--dragged': tabDragName === name,
                'sn-tab-cell--pivot': isPivotSheet(name),
              }"
              :draggable="!readOnly && !isRenaming(name)"
              @dragstart="emit('drag-start', $event, name)"
              @dragend="emit('drag-end')"
              @dragover.prevent="emit('drag-over', $event, name)"
              @drop.prevent="emit('tab-drop', $event, name)"
            >
              <TabTrigger
                :value="name"
                :label="isRenaming(name) ? renamedLabel : name"
                :icon-left="isPivotSheet(name) ? 'lucide-layout' : undefined"
                class="sn-tab-trigger"
                :class="{ 'sn-tab-trigger--renaming': isRenaming(name) }"
                @mousedown="emit('tab-mousedown', $event, name)"
                @click="emit('tab-click', name)"
                @dblclick="!readOnly && startRenaming(name)"
                @contextmenu.prevent="emit('tab-menu', $event, name)"
              >
                <!-- Peer dots — one colored circle per peer currently on this
                   tab. Capped at 3 + a "+N" overflow so a busy tab doesn't
                   blow out the tab's width. -->
                <template v-if="peersBySubSheet.get(name)?.length" #suffix>
                  <span class="sn-tab-peers">
                    <span
                      v-for="p in peersBySubSheet.get(name)!.slice(0, 3)"
                      :key="p.user"
                      class="sn-tab-peer-dot sn-peer"
                      :style="colourStyle(p.colour)"
                      :title="p.full_name"
                    />
                    <span
                      v-if="peersBySubSheet.get(name)!.length > 3"
                      class="sn-tab-peer-more"
                      :title="`${peersBySubSheet.get(name)!.length - 3} more`"
                      >+{{ peersBySubSheet.get(name)!.length - 3 }}</span
                    >
                  </span>
                </template>
              </TabTrigger>
              <input
                v-if="isRenaming(name)"
                v-model="renamedLabel"
                v-on-outside-click="leaveRename"
                v-select-on-mount
                class="sn-tab-name-field"
                :class="{ 'sn-tab-name-field--rejected': renameRejected }"
                :aria-label="__('Sheet name')"
                :aria-invalid="renameRejected"
                @input="renameRejected = false"
                @keydown.enter="submitRename"
                @keydown.esc="stopRenaming(true)"
              />
            </span>
          </template>
        </TabList>
      </Tabs>
    </div>

    <div v-if="selectionStats" class="sn-stats">
      <span v-if="selectionStats.count > 0">Count: {{ selectionStats.count }}</span>
      <span v-if="selectionStats.sum !== null">Sum: {{ formatStat(selectionStats.sum) }}</span>
      <span v-if="selectionStats.avg !== null">Avg: {{ formatStat(selectionStats.avg) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// The bottom bar, extracted from SheetEditor/index.vue. Tab switching,
// renaming, reordering and the tab menu stay in the editor; this renders the
// tabs, runs the rename field and reports pointer events back.
import { Button, TabList, Tabs, TabTrigger, toast, vOnOutsideClick } from 'frappe-ui'
import { nextTick, ref, watch } from 'vue'

import { colourStyle, type PeerColour } from '@/platform/collab/colours'
import { translate as __ } from '@/platform/translation'

type Peer = { user: string; full_name: string; colour: PeerColour }
type SelectionStats = { count: number; sum: number | null; avg: number | null }

const props = defineProps<{
  readOnly: boolean
  sheetNames: string[]
  currentSheet: string
  isPivotSheet: (name: string) => boolean
  tabDragOver: string | null
  tabDragName: string | null
  peersBySubSheet: Map<string, Peer[]>
  selectionStats: SelectionStats | null
  /** Applies a rename; false when the name can't be used. */
  renameSheet: (from: string, to: string) => boolean
}>()
const emit = defineEmits<{
  'add-sheet': []
  'drag-start': [e: DragEvent, name: string]
  'drag-end': []
  'drag-over': [e: DragEvent, name: string]
  'tab-drop': [e: DragEvent, name: string]
  'tab-mousedown': [e: MouseEvent, name: string]
  'tab-click': [name: string]
  'rename-end': []
  'tab-menu': [e: MouseEvent, name: string]
}>()

// The sliding highlight re-measures on a new selection or a size change, and a
// reorder is neither. Remounting the tabs puts it back on the active sheet.
const orderVersion = ref(0)
watch(
  () => props.sheetNames,
  (next, prev) => {
    const reordered =
      next.length === prev.length &&
      next.every((name) => prev.includes(name)) &&
      next.some((name, i) => name !== prev[i])
    if (reordered) orderVersion.value++
  },
)

const renamingName = ref<string | null>(null)
const renamedLabel = ref('')
const renameRejected = ref(false)
// The field waits for the closing menu, whose click would otherwise count as a
// click outside it.
const isRenameReady = ref(false)

function isRenaming(name: string) {
  return renamingName.value === name && isRenameReady.value
}

const vSelectOnMount = {
  mounted(input: HTMLInputElement) {
    input.focus()
    input.select()
  },
}

async function startRenaming(name: string) {
  if (props.readOnly) return
  renamingName.value = name
  renamedLabel.value = name
  renameRejected.value = false
  await nextTick()
  setTimeout(() => (isRenameReady.value = true), 50)
}

function stopRenaming(refocus: boolean) {
  renamingName.value = null
  renamedLabel.value = ''
  isRenameReady.value = false
  renameRejected.value = false
  if (refocus) emit('rename-end')
}

// False only when the editor turns the name down; a blank or unchanged name
// simply keeps the old one.
function applyRename() {
  const from = renamingName.value
  const to = renamedLabel.value.trim()
  return !from || !to || to === from || props.renameSheet(from, to)
}

// Enter on a taken name leaves the field open, so the name can be fixed.
function submitRename() {
  if (applyRename()) {
    stopRenaming(true)
    return
  }
  renameRejected.value = true
  toast.error(__('A sheet with this name already exists'))
}

// Clicking away or changing sheet ends the rename either way. The grid is not
// refocused: the click may have been on the formula bar or another field.
function leaveRename() {
  if (!renamingName.value) return
  applyRename()
  stopRenaming(false)
}

watch(() => props.currentSheet, leaveRename)

defineExpose({ startRenaming })

function formatStat(n: number) {
  return Number.isInteger(n) ? n.toLocaleString() : parseFloat(n.toFixed(4)).toLocaleString()
}
</script>

<style scoped>
/* ── Bottom · tabs + stats ───────────────────────────────────────────────── */
.sn-bottom {
  display: flex;
  align-items: stretch;
  height: 36px;
  border-top: 1px solid var(--outline-gray-2);
  background: var(--surface-base);
  flex-shrink: 0;
  overflow: hidden;
}

.sn-tabs-track {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  padding: 0 6px;
}
.sn-tabs-track::-webkit-scrollbar {
  display: none;
}

/* The trigger and the rename field share one grid area. */
.sn-tab-cell {
  display: grid;
  flex-shrink: 0;
  min-width: 40px;
  max-width: 240px;
}
.sn-tab-cell > * {
  grid-area: 1 / 1;
}
.sn-tab-cell--dragged {
  opacity: 0.4;
}
.sn-tab-trigger {
  min-width: 0;
  max-width: 100%;
}
.sn-tab-trigger > :deep(*) {
  max-width: 100%;
}
.sn-tab-trigger--renaming {
  opacity: 0;
}
.sn-tab-trigger--renaming :deep(span) {
  white-space: pre;
}

/* Text sits exactly where the tab's own label sits, and the field adds no width
   of its own, so renaming starts in place. */
.sn-tab-name-field,
.sn-tab-name-field:focus {
  @apply w-0 min-w-full rounded-[7px] border-0 bg-transparent px-2 py-0 text-base leading-tighter text-ink-gray-8 shadow-none outline-none ring-1 ring-inset ring-outline-gray-3;
}
.sn-tab-name-field--rejected,
.sn-tab-name-field--rejected:focus {
  @apply ring-outline-red-3;
}
/* A pivot tab's label starts after its icon. */
.sn-tab-cell--pivot .sn-tab-name-field {
  padding-left: 32px;
}

/* ── Per-tab peer dots ──────────────────────────────────────────────────
   One coloured circle per remote user currently looking at this tab.
   Capped to 3 visible + "+N" overflow so a popular tab can't blow out
   the tabs track. */
.sn-tab-peers {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.sn-tab-peer-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--rc-tint);
  box-shadow: inset 0 0 0 1px var(--rc-ink);
}
.sn-tab-peer-more {
  font-size: 9px;
  font-weight: 600;
  color: var(--ink-gray-7);
  margin-left: 2px;
  line-height: 1;
}

.sn-tab-add-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  align-self: center;
  margin-left: 8px;
}
/* Feather `plus` sits ~1px high inside its box; pull the glyph down so it
   lands on the same optical row as the tab labels' text. */
.sn-tab-add :deep(svg) {
  display: block;
  position: relative;
  top: 1px;
}

/* No position of its own: the sliding highlight measures tabs against the list. */
.sn-tab-drop-mark {
  flex-shrink: 0;
  width: 2px;
  height: 16px;
  margin: 0 -1px;
  background: var(--ink-gray-9);
}

.sn-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 14px;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--ink-gray-6);
  flex-shrink: 0;
  white-space: nowrap;
  border-left: 1px solid var(--outline-gray-2);
  height: 100%;
}
</style>
