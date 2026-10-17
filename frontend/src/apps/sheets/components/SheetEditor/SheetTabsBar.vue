<template>
  <!-- Bottom bar: add sheet, the sheet tabs (drag to reorder, chevron for the
  tab menu, peer dots) and the selection's Count / Sum / Avg. -->
  <div class="sn-bottom">
    <!-- Pinned outside the scroll track so it stays reachable no matter
       how many tabs there are. The wrapper owns the divider + margins so
       the Button itself stays a clean square pill (frappe-ui puts our
       `class` on the <button> root, so any spacing/border set on it would
       become part of the button's own hover box). -->
    <!-- Add-sheet is a mutation, so viewers don't get it — hide the whole
       wrapper (button + its divider) rather than leave a dead, greyed pill. -->
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
      <div
        v-for="name in sheetNames"
        :key="name"
        class="sn-tab"
        :class="{
          'sn-tab--active': name === currentSheet,
          'sn-tab--pivot': isPivotSheet(name),
          'sn-tab-drag-over': tabDragOver === name && tabDragName !== name,
          'sn-tab--static': readOnly,
        }"
        :draggable="!readOnly"
        @dragstart="emit('drag-start', $event, name)"
        @dragend="emit('drag-end')"
        @dragover.prevent="emit('drag-over', $event, name)"
        @drop.prevent="emit('tab-drop', $event, name)"
      >
        <!-- One visual unit: label + chevron share a single pill background
           so they read as one button. The chevron — the tab-menu affordance
           — renders only when editable; a viewer has no tab actions, so it
           would be a dead button. Clicking the label switches sheets. -->
        <Button
          variant="ghost"
          size="sm"
          :icon-left="isPivotSheet(name) ? 'lucide-layout' : undefined"
          :label="name"
          class="sn-tab-btn"
          @mousedown="emit('tab-mousedown', $event, name)"
          @click="emit('tab-click', name)"
          @dblclick="emit('rename', name)"
          @contextmenu.prevent="emit('tab-menu', $event, name)"
        />
        <Button
          v-if="!readOnly"
          variant="ghost"
          size="sm"
          icon="lucide-chevron-down"
          class="sn-tab-chevron"
          :aria-label="`${name} options`"
          @click.stop="emit('tab-menu', $event, name)"
        />
        <!-- Peer dots — one colored circle per peer currently on this
           tab. Capped at 3 + a "+N" overflow so a busy tab doesn't
           blow out the tab's width. -->
        <span v-if="peersBySubSheet.get(name)?.length" class="sn-tab-peers">
          <span
            v-for="p in peersBySubSheet.get(name)!.slice(0, 3)"
            :key="p.user"
            class="sn-tab-peer-dot"
            :style="{ '--rc': p.color }"
            :title="p.full_name"
          />
          <span
            v-if="peersBySubSheet.get(name)!.length > 3"
            class="sn-tab-peer-more"
            :title="`${peersBySubSheet.get(name)!.length - 3} more`"
            >+{{ peersBySubSheet.get(name)!.length - 3 }}</span
          >
        </span>
      </div>
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
// tabs and reports pointer events back.
import { Button } from 'frappe-ui'

type Peer = { user: string; full_name: string; color: string }
type SelectionStats = { count: number; sum: number | null; avg: number | null }

defineProps<{
  readOnly: boolean
  sheetNames: string[]
  currentSheet: string
  isPivotSheet: (name: string) => boolean
  tabDragOver: string | null
  tabDragName: string | null
  peersBySubSheet: Map<string, Peer[]>
  selectionStats: SelectionStats | null
}>()
const emit = defineEmits<{
  'add-sheet': []
  'drag-start': [e: DragEvent, name: string]
  'drag-end': []
  'drag-over': [e: DragEvent, name: string]
  'tab-drop': [e: DragEvent, name: string]
  'tab-mousedown': [e: MouseEvent, name: string]
  'tab-click': [name: string]
  rename: [name: string]
  'tab-menu': [e: MouseEvent, name: string]
}>()

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
  background: var(--surface-sidebar);
  flex-shrink: 0;
  overflow: hidden;
}

.sn-tabs-track {
  display: flex;
  align-items: stretch;
  flex: 1;
  gap: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  padding: 0 6px;
}
.sn-tabs-track::-webkit-scrollbar {
  display: none;
}

.sn-tab {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  position: relative;
  cursor: grab;
  /* The tab itself owns the pill background so label + chevron merge
     into a single visual unit — no inter-button seam, no double-pill
     look. The inner Buttons are transparent and rely on this wrapper
     for their background. */
  border-radius: 6px;
  transition: background-color 0.12s;
}
.sn-tab:active {
  cursor: grabbing;
}
.sn-tab:hover {
  background: var(--surface-gray-2);
}
.sn-tab--active,
.sn-tab--active:hover {
  background: var(--surface-gray-3);
}

/* Active indicator: 2px line at the bottom */
.sn-tab--active::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 6px;
  right: 6px;
  height: 2px;
  background: var(--ink-gray-9);
  border-radius: 1px 1px 0 0;
}
.sn-tab--pivot.sn-tab--active::after {
  background: var(--ink-cyan-7, #0e7490);
}

/* Main label Button — transparent so the wrapper's pill shows through, with
   no internal hover/active background of its own; that lives on `.sn-tab`.
   frappe-ui forwards our `class` onto the <button> root itself (there is no
   inner button), so we style `.sn-tab-btn` directly — a `:deep(button)`
   descendant selector matches nothing and leaves the native ghost hover pill
   showing through, which is what made the label and chevron highlight as two
   separate pills. `background` is forced so it beats the native
   `hover:/active:` background utilities at equal specificity. */
.sn-tab-btn {
  font-size: 12px;
  font-weight: 400;
  color: var(--ink-gray-7);
  /* Tight right padding so the label flows directly into the chevron and
     the pair reads as one pill on every tab. */
  padding: 0 2px 0 8px !important;
  height: 28px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 148px;
  border-radius: 0 !important;
  background: transparent !important;
}
.sn-tab--active .sn-tab-btn {
  font-weight: 600;
  color: var(--ink-gray-9);
}

/* Pivot icon tint */
.sn-tab--pivot .sn-tab-btn :deep(.icon) {
  color: var(--ink-cyan-7, #0e7490);
}

/* ── Per-tab peer dots ──────────────────────────────────────────────────
   One coloured circle per remote user currently looking at this tab.
   Sits in the tab's right edge, before the chevron when the tab is
   active. Capped to 3 visible + "+N" overflow so a popular tab can't
   blow out the tabs track. */
.sn-tab-peers {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: 6px;
  pointer-events: auto;
}
.sn-tab-peer-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--rc);
  box-shadow: 0 0 0 1px var(--surface-base);
}
.sn-tab-peer-more {
  font-size: 9px;
  font-weight: 600;
  color: var(--ink-gray-7);
  margin-left: 2px;
  line-height: 1;
}

/* Chevron — sits flush against the label inside the same pill so the two read
   as one button. Styled directly on the <button> (same reason as `.sn-tab-btn`
   above), transparent so it shares the wrapper's pill instead of drawing its
   own. `width:auto` overrides frappe-ui's fixed-square `w-7` so the chevron
   hugs the label rather than reserving a full 28px cell. Slightly muted on
   inactive tabs, full ink on the active one (matches the label's color). */
.sn-tab-chevron {
  padding: 0 6px 0 0 !important;
  width: auto !important;
  height: 28px;
  border-radius: 0 !important;
  background: transparent !important;
  color: var(--ink-gray-5);
}
.sn-tab-chevron:hover {
  color: var(--ink-gray-9);
}
.sn-tab--active .sn-tab-chevron {
  color: var(--ink-gray-8);
}

/* Add-sheet button — the wrapper carries the divider + margins so the Button
   itself stays a clean square pill with its own contained hover box (any
   border/padding set on `.sn-tab-add` would land on the <button> root and
   distend its hover fill). Full-height flex box keeps the 28px button
   optically centered against the tab labels. */
.sn-tab-add-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  align-self: center;
  margin: 0 8px 0 12px;
  padding-right: 8px;
  border-right: 1px solid var(--outline-gray-2);
}
/* Feather `plus` sits ~1px high inside its box; pull the glyph down so it
   lands on the same optical row as the tab labels' text. */
.sn-tab-add :deep(svg) {
  display: block;
  position: relative;
  top: 1px;
}

.sn-tab-drag-over::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--ink-gray-9);
  border-radius: 1px;
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

/* Sheet-tab drag visual — Espresso ink-gray-9 left edge on the drop target. */
.sn-tab {
  cursor: grab;
}
.sn-tab:active {
  cursor: grabbing;
}

/* Viewer tabs — no chevron, no drag. The `.sn-tab-btn` right padding is only
   2px because it normally butts against the chevron; with the chevron gone the
   label needs its own symmetric breathing room. And a grab cursor lies about a
   tab that can't be dragged — clicking still switches sheets, so use pointer.
   Placed after the base `.sn-tab` cursor rules to win on equal specificity. */
.sn-tab--static,
.sn-tab--static:active {
  cursor: pointer;
}
.sn-tab--static .sn-tab-btn {
  padding-right: 8px !important;
}

.sn-tab-drag-over::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--ink-gray-9);
  border-radius: 1px;
}
</style>
