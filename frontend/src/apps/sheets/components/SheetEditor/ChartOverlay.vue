<template>
  <!-- `suppressed` hides the whole overlay while the chart dialog is open
       so the chart's selection ring + edit/refresh/delete toolbar can't
       float over the dialog body. Using `visibility:hidden` (not v-show
       /display:none) keeps the layer measurable — echarts' autoresize
       sees a stable container size and doesn't collapse the chart to
       zero on the way back. -->
  <div
    class="co-layer"
    :style="suppressed ? { visibility: 'hidden', pointerEvents: 'none' } : null"
    @mousedown="_onLayerMousedown"
  >
    <div
      v-for="chart in chartsForSheet"
      :key="chart.id"
      class="co-host"
      :class="{ 'co-host--selected': selectedId === chart.id }"
      :style="_hostStyle(chart)"
      @mousedown.stop="_startDrag(chart, $event)"
      @dblclick.stop="$emit('edit', chart.id)"
    >
      <ChartView
        :config="chart"
        :matrix="_matrixFor(chart)"
        :width="chart.position?.width || 480"
        :height="chart.position?.height || 320"
      />

      <!-- Action bar (visible while selected) -->
      <div v-if="selectedId === chart.id" class="co-actions" @mousedown.stop>
        <button class="co-action" title="Edit chart" @click="$emit('edit', chart.id)">
          <FeatherIcon name="edit-2" class="co-action-icon" />
        </button>
        <button class="co-action" title="Refresh data" @click="$emit('refresh', chart.id)">
          <FeatherIcon name="refresh-cw" class="co-action-icon" />
        </button>
        <button class="co-action co-action--danger" title="Delete chart" @click="$emit('delete', chart.id)">
          <FeatherIcon name="trash-2" class="co-action-icon" />
        </button>
      </div>

      <!-- Resize handle (bottom-right corner only — keeps it simple) -->
      <div
        v-if="selectedId === chart.id"
        class="co-resize"
        @mousedown.stop="_startResize(chart, $event)"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { FeatherIcon } from 'frappe-ui'
// Lazy-load ChartView so ECharts (~600 KB) only enters the bundle when a
// sheet actually has charts. Vite produces a separate chunk for the
// component and all its transitive `echarts/*` imports.
const ChartView = defineAsyncComponent(() => import('./ChartView.vue'))

const props = defineProps({
  // List of all chart configs across all sheets — the overlay filters down
  // to the active sub-sheet itself.
  charts:       { type: Array,  default: () => [] },
  currentSheet: { type: String, required: true },
  // (sourceSheet, sourceRange) → 2D matrix. Caller-owned so it can pull from
  // the sheet engine and re-derive on cell edits.
  getMatrix:    { type: Function, required: true },
  // Bumps when the source data should be re-pulled — on refresh and on any
  // sheet cell edit, but NOT on drag/resize/scroll. Part of the matrix cache
  // key so position-only re-renders (drag/resize) reuse the cached matrix
  // instead of re-materialising it every frame, while edits refresh the chart.
  dataVersion:  { type: Number, default: 0 },
  selectedId:   { type: String, default: '' },
  // When true the whole overlay is hidden (e.g. while the chart dialog is
  // open) — prevents the chart's z-indexed action toolbar from floating
  // over the dialog body.
  suppressed:   { type: Boolean, default: false },
})
const emit = defineEmits(['select', 'edit', 'delete', 'refresh', 'move', 'resize'])

const chartsForSheet = computed(() => props.charts.filter(c => c.position?.sheet === props.currentSheet))

function _hostStyle(chart) {
  const p = chart.position || {}
  return {
    transform: `translate(${p.x || 0}px, ${p.y || 0}px)`,
    width:  (p.width  || 480) + 'px',
    height: (p.height || 320) + 'px',
  }
}

// Cache the materialised matrix per chart, keyed by source + dataVersion. This
// runs in the template, so it fires on every overlay re-render — including the
// chartVersion bumps that move/resize trigger on each drag frame. Without the
// cache, dragging a chart over a 100k-row source re-pulled the whole range
// (and made ChartView rebuild the ECharts option) every mouse move.
const _matrixCache = new Map()
function _matrixFor(chart) {
  const key = `${chart.sourceSheet}\x00${chart.sourceRange}\x00${props.dataVersion}`
  const hit = _matrixCache.get(chart.id)
  if (hit && hit.key === key) return hit.matrix
  const matrix = props.getMatrix(chart.sourceSheet, chart.sourceRange) || []
  _matrixCache.set(chart.id, { key, matrix })
  return matrix
}

// ── Drag (move) ──────────────────────────────────────────────────────────────

let _drag = null

function _startDrag(chart, e) {
  emit('select', chart.id)
  _drag = {
    id:     chart.id,
    startX: e.clientX,
    startY: e.clientY,
    origX:  chart.position?.x || 0,
    origY:  chart.position?.y || 0,
  }
  document.addEventListener('mousemove', _onDragMove)
  document.addEventListener('mouseup',   _onDragEnd)
}

function _onDragMove(e) {
  if (!_drag) return
  const nx = Math.max(0, _drag.origX + (e.clientX - _drag.startX))
  const ny = Math.max(0, _drag.origY + (e.clientY - _drag.startY))
  emit('move', _drag.id, { x: nx, y: ny })
}

function _onDragEnd() {
  document.removeEventListener('mousemove', _onDragMove)
  document.removeEventListener('mouseup',   _onDragEnd)
  _drag = null
}

// ── Resize (BR handle) ──────────────────────────────────────────────────────

let _resize = null

function _startResize(chart, e) {
  emit('select', chart.id)
  _resize = {
    id:     chart.id,
    startX: e.clientX,
    startY: e.clientY,
    origW:  chart.position?.width  || 480,
    origH:  chart.position?.height || 320,
  }
  document.addEventListener('mousemove', _onResizeMove)
  document.addEventListener('mouseup',   _onResizeEnd)
}

function _onResizeMove(e) {
  if (!_resize) return
  const nw = Math.max(200, _resize.origW + (e.clientX - _resize.startX))
  const nh = Math.max(160, _resize.origH + (e.clientY - _resize.startY))
  emit('resize', _resize.id, { width: nw, height: nh })
}

function _onResizeEnd() {
  document.removeEventListener('mousemove', _onResizeMove)
  document.removeEventListener('mouseup',   _onResizeEnd)
  _resize = null
}

// Click outside a chart deselects.
function _onLayerMousedown(e) {
  if (e.target.closest('.co-host')) return
  emit('select', '')
}
</script>

<style scoped>
.co-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;  /* let canvas receive clicks; charts opt back in */
  /* Above .sn-pivot-fab (z-20) and .sn-pivot-highlight (z-15) so a chart
     dragged on top of a pivot table fully occludes both the pivot's edit
     fab and its dotted output border — otherwise they punch through the
     chart card and the visual reads as broken. */
  z-index: 25;
}
.co-host {
  position: absolute;
  top: 0; left: 0;
  pointer-events: auto;
  cursor: move;
  background: var(--surface-base, #ffffff);
  border-radius: 10px;
  border: 1px solid var(--outline-gray-2, #e5e5e5);
  box-shadow:
    0 0 0 1px rgba(0,0,0,.02),
    0 4px 12px -4px rgba(0,0,0,.08);
  transition: border-color .12s, box-shadow .12s;
}
.co-host:hover { border-color: var(--outline-gray-3, #d4d4d4); }
.co-host--selected {
  border-color: var(--ink-cyan-6, #0891B2);
  box-shadow:
    0 0 0 2px rgba(8,145,178,.18),
    0 6px 16px -4px rgba(0,0,0,.12);
}

.co-actions {
  position: absolute;
  top: -36px;
  right: 0;
  display: flex; gap: 4px;
  padding: 4px;
  background: var(--surface-base);
  border: 1px solid var(--outline-gray-2);
  border-radius: 8px;
  box-shadow: 0 4px 12px -4px rgba(0,0,0,.12);
}
.co-action {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 0; border-radius: 4px;
  color: var(--ink-gray-7); cursor: pointer;
  transition: background-color .1s, color .1s;
}
.co-action:hover            { background: var(--surface-gray-2); color: var(--ink-gray-9); }
.co-action--danger:hover    { background: var(--surface-red-1, #fee2e2); color: var(--ink-red-6, #dc2626); }
.co-action-icon             { width: 14px; height: 14px; }

.co-resize {
  position: absolute;
  bottom: -4px; right: -4px;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--ink-cyan-6, #0891B2);
  border: 2px solid var(--surface-base);
  cursor: nwse-resize;
}
</style>
