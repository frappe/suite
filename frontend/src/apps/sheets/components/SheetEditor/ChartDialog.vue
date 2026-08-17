<template>
  <Dialog v-model:open="show" :title="chartId ? 'Edit chart' : 'Insert chart'" size="4xl">
    <template #default>

      <!-- ── Source range ─────────────────────────────────────────────── -->
      <div class="cd-section">
        <p class="cd-label">Source range</p>
        <div class="cd-range-row">
          <FormControl
            v-model="rangeInput"
            type="text"
            placeholder="e.g. A1:D20"
            class="cd-range-input"
            @blur="detect"
            @keydown.enter.prevent="detect"
          />
          <Button size="sm" variant="outline" label="Detect" @click="detect" />
          <FormControl
            type="checkbox"
            v-model="hasHeader"
            label="First row is header"
            class="cd-header-toggle"
            @change="detect"
          />
        </div>
        <p v-if="rangeError" class="cd-error">{{ rangeError }}</p>
      </div>

      <!-- ── Chart type picker ────────────────────────────────────────── -->
      <div class="cd-section">
        <p class="cd-label">Chart type</p>
        <div class="cd-type-grid">
          <button
            v-for="t in CHART_TYPES"
            :key="t"
            class="cd-type-btn"
            :class="{ 'cd-type-btn--active': chartType === t }"
            @click="chartType = t"
          >
            <FeatherIcon :name="CHART_ICONS[t]" class="cd-type-icon" />
            <span>{{ _label(t) }}</span>
          </button>
        </div>
      </div>

      <!-- ── Encoding + Preview side by side ────────────────────────────-->
      <div v-if="columns.length" class="cd-grid">
        <div class="cd-encoding">
          <p class="cd-label">Title</p>
          <FormControl v-model="title" type="text" placeholder="(optional)" />

          <p class="cd-label" style="margin-top:14px">
            {{ chartType === 'pie' ? 'Labels' : 'X axis' }}
          </p>
          <!-- Combobox keeps the dropdown anchored + scrollable + searchable.
                Native <select> on macOS renders a system popover that grows to
                fit all options and clips on top of the dialog body. -->
          <Combobox
            :model-value="String(xCol)"
            :options="columnOptions"
            trigger="button"
            placeholder="Pick a column"
            @update:model-value="onXAxisChange"
          />

          <p class="cd-label" style="margin-top:14px">
            {{ chartType === 'pie' ? 'Aggregate slices' : 'Aggregate' }}
          </p>
          <FormControl type="select" v-model="opts.aggregate" :options="CHART_AGGREGATIONS" />
          <p v-if="opts.aggregate !== 'none'" class="cd-hint">
            Rows sharing the same {{ chartType === 'pie' ? 'label' : 'X value' }} are grouped and summarised.
          </p>

          <div class="cd-series-head" style="margin-top:14px">
            <p class="cd-label" style="margin:0">
              {{ chartType === 'pie' ? 'Values' : 'Series' }}
              <span class="cd-series-count">{{ yCols.length }} / {{ columns.length - 1 }}</span>
            </p>
            <Button size="sm" variant="ghost" label="Numeric only" @click="selectNumericSeries" />
          </div>
          <FormControl
            v-model="seriesFilter"
            type="text"
            placeholder="Filter columns…"
            class="cd-series-filter"
          />
          <div class="cd-series-list" ref="seriesListRef">
            <!-- Master row: toggles every visible column. Indeterminate when
                 only some of the visible columns are selected — same UX as
                 file-manager multi-selects, so users don't have to scroll. -->
            <div class="cd-series-row cd-series-row--master" @click="toggleMasterSelection">
              <FormControl
                type="checkbox"
                :model-value="masterCheckState === 'all'"
                @update:model-value="toggleMasterSelection"
                @click.stop
              />
              <span class="cd-series-label">
                <strong>{{ masterCheckLabel }}</strong>
              </span>
            </div>
            <div
              v-for="col in filteredColumns"
              :key="col.idx"
              class="cd-series-row"
              :class="{ 'cd-series-row--disabled': col.idx === xCol }"
              @click="col.idx !== xCol && _toggleY(col.idx)"
            >
              <FormControl
                type="checkbox"
                :model-value="yCols.includes(col.idx)"
                :disabled="col.idx === xCol"
                @update:model-value="_toggleY(col.idx)"
                @click.stop
              />
              <span class="cd-series-label">{{ col.label }}</span>
              <span v-if="col.isNumeric" class="cd-series-tag">#</span>
            </div>
            <div v-if="!filteredColumns.length" class="cd-series-empty">
              No columns match "{{ seriesFilter }}"
            </div>
          </div>

          <p class="cd-label" style="margin-top:14px">Options</p>
          <div class="cd-options">
            <FormControl v-if="chartType !== 'pie'" type="checkbox" v-model="opts.showLegend"  label="Show legend" />
            <FormControl                            type="checkbox" v-model="opts.dataLabels"  label="Show data labels" />
            <FormControl v-if="chartType !== 'pie'" type="checkbox" v-model="opts.gridLines"   label="Show grid lines" />
            <FormControl v-if="chartType === 'line' || chartType === 'area'" type="checkbox" v-model="opts.smooth"  label="Smooth curves" />
            <FormControl v-if="chartType === 'bar'  || chartType === 'area'" type="checkbox" v-model="opts.stacked" label="Stacked" />
          </div>

          <div class="cd-colors-head" style="margin-top:14px">
            <p class="cd-label" style="margin:0">Colors</p>
            <Button v-if="hasCustomColors" size="sm" variant="ghost" label="Reset" @click="resetColors" />
          </div>
          <div class="cd-palettes">
            <button
              v-for="p in CHART_PALETTES"
              :key="p.name"
              type="button"
              class="cd-palette"
              :class="{ 'cd-palette--active': activePaletteName === p.name }"
              :title="p.name"
              @click="applyPalette(p)"
            >
              <span
                v-for="(c, i) in p.colors.slice(0, 5)"
                :key="i"
                class="cd-palette-stop"
                :style="{ background: c }"
              />
            </button>
          </div>
          <!-- Per-series overrides only make sense for cartesian charts, where
               the colour array maps positionally to series. A pie maps colours
               to slices (rows), not series, so the palette presets above are the
               only meaningful control there. -->
          <div v-if="chartType !== 'pie' && selectedSeries.length" class="cd-series-colors">
            <label v-for="s in selectedSeries" :key="s.idx" class="cd-series-color">
              <input
                type="color"
                class="cd-color-input"
                :value="s.color"
                @input="setSeriesColor(s.idx, $event.target.value)"
              />
              <span class="cd-series-color-label">{{ s.label }}</span>
            </label>
          </div>
        </div>

        <div class="cd-preview">
          <p class="cd-label">Preview</p>
          <div class="cd-preview-frame">
            <ChartView v-if="previewConfig" :config="previewConfig" :matrix="previewMatrix" width="auto" height="auto" />
            <div v-else class="cd-preview-placeholder">Pick a series to see a preview</div>
          </div>
        </div>
      </div>

    </template>

    <template #actions>
      <div class="flex flex-row-reverse gap-2">
        <Button
          variant="solid"
          :disabled="!canCommit"
          :label="chartId ? 'Update chart' : 'Insert chart'"
          @click="onConfirm"
        />
        <Button @click="show = false">Cancel</Button>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue'
import { Button, Combobox, Dialog, FormControl } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
// Lazy-load — same rationale as in ChartOverlay.
const ChartView = defineAsyncComponent(() => import('./ChartView.vue'))
import { CHART_TYPES, CHART_PALETTES, ESPRESSO_PALETTE, CHART_AGGREGATIONS } from '../../engine/charts.js'

const CHART_ICONS = {
  line:    'trending-up',
  bar:     'bar-chart-2',
  area:    'activity',
  pie:     'pie-chart',
  scatter: 'git-commit',
}

const props = defineProps({
  modelValue:   { type: Boolean, default: false },
  sheet:        { type: Object,  required: true },
  currentSheet: { type: String,  default: '' },
  initialRange: { type: String,  default: '' },
  chartId:      { type: String,  default: '' },
  existingConfig: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'confirm'])

const show = computed({
  get: () => props.modelValue,
  set: v  => emit('update:modelValue', v),
})

// ── State ───────────────────────────────────────────────────────────────────

const rangeInput  = ref('')
const rangeError  = ref('')
const chartType   = ref('bar')
const title       = ref('')
const hasHeader   = ref(true)
const xCol        = ref(0)
const yCols       = ref([])             // selected column indices
const opts        = reactive({ showLegend: true, smooth: false, stacked: false, dataLabels: true, gridLines: true, colorScheme: undefined, aggregate: 'none' })

// Resolved each `detect()` — the actual values backing the preview.
const matrix      = ref([])
const columns     = ref([])             // [{ idx, label, isNumeric }]
const seriesFilter = ref('')

// ── Reset state when dialog opens ───────────────────────────────────────────

watch(show, (open) => {
  if (!open) return
  if (props.existingConfig) {
    const c = props.existingConfig
    rangeInput.value = c.sourceRange || ''
    chartType.value  = c.chartType   || 'bar'
    title.value      = c.title       || ''
    hasHeader.value  = c.hasHeader !== false
    xCol.value       = c.encoding?.x ?? 0
    yCols.value      = c.encoding?.y ? [...c.encoding.y] : []
    Object.assign(opts, { showLegend: true, smooth: false, stacked: false, dataLabels: false, gridLines: true, colorScheme: undefined, aggregate: 'none', ...c.options })
    detect()
  } else {
    rangeInput.value = props.initialRange || ''
    chartType.value  = 'bar'
    title.value      = ''
    hasHeader.value  = true
    xCol.value       = 0
    yCols.value      = []
    Object.assign(opts, { showLegend: true, smooth: false, stacked: false, dataLabels: true, gridLines: true, colorScheme: undefined, aggregate: 'none' })
    if (rangeInput.value) detect()
  }
})

// ── Range detection ────────────────────────────────────────────────────────-

function detect() {
  let range = rangeInput.value.trim()
  // Empty range → try to auto-find the data block on the source sheet so
  // the user gets useful behaviour out of the Detect button instead of just
  // "type a range first".
  if (!range) {
    range = _autoDetectRange()
    if (!range) {
      rangeError.value = 'No data found on this sheet. Type a range like A1:D20.'
      matrix.value = []; columns.value = []
      return
    }
    rangeInput.value = range
  }
  const [start, end] = range.includes(':') ? range.split(':') : [range, range]
  const data = props.sheet.getRangeValues(start, end, props.currentSheet)
  if (!data || !data.length) { rangeError.value = 'Could not read range.'; matrix.value = []; columns.value = []; return }
  rangeError.value = ''
  matrix.value = data
  const ncols = data[0]?.length || 0
  const header = hasHeader.value ? data[0] : null
  // Detect numeric columns by sampling the body rows (excluding the header
  // row). A column is numeric if a majority of its sampled values parse as
  // numbers — robust against the occasional stray text cell.
  const bodyStart = hasHeader.value ? 1 : 0
  const sampleEnd = Math.min(data.length, bodyStart + 20)
  columns.value = []
  for (let i = 0; i < ncols; i++) {
    let numHits = 0, total = 0
    for (let r = bodyStart; r < sampleEnd; r++) {
      const v = data[r]?.[i]
      if (v === '' || v == null) continue
      total++
      if (!isNaN(Number(v))) numHits++
    }
    columns.value.push({
      idx:       i,
      label:     header?.[i] ? String(header[i]) : `Column ${_colLetter(i)}`,
      isNumeric: total > 0 && numHits / total >= 0.6,
    })
  }
  // Default encoding: first column on X, all numeric columns on Y. Cap at
  // 8 so the preview doesn't choke on a 50-series wall of colour.
  if (!props.existingConfig || yCols.value.length === 0) {
    xCol.value  = 0
    yCols.value = columns.value
      .filter(c => c.idx !== 0 && c.isNumeric)
      .slice(0, 8)
      .map(c => c.idx)
    if (!yCols.value.length && ncols > 1) yCols.value = [1]
  }
}

const columnOptions = computed(() => columns.value.map(c => ({ label: c.label, value: String(c.idx) })))

function onXAxisChange(opt) {
  if (!opt) return
  xCol.value = parseInt(opt, 10)
  // If the new X axis was previously selected as a Y series, drop it —
  // otherwise the same column would feed both axes and the chart breaks.
  if (yCols.value.includes(xCol.value)) {
    yCols.value = yCols.value.filter(v => v !== xCol.value)
  }
}

// Filter on label substring (case-insensitive). With 50+ columns the
// checkbox list is otherwise unscannable.
const filteredColumns = computed(() => {
  const q = seriesFilter.value.trim().toLowerCase()
  if (!q) return columns.value
  return columns.value.filter(c => c.label.toLowerCase().includes(q))
})

function _toggleY(idx) {
  if (yCols.value.includes(idx)) yCols.value = yCols.value.filter(v => v !== idx)
  else                            yCols.value = [...yCols.value, idx].sort((a, b) => a - b)
}

function selectNumericSeries() {
  yCols.value = columns.value
    .filter(c => c.idx !== xCol.value && c.isNumeric)
    .map(c => c.idx)
}

// ── Colors ─────────────────────────────────────────────────────────────────-
//
// `opts.colorScheme` is either undefined (→ default Espresso palette) or an
// explicit hex array used verbatim as ECharts `color`. The array maps
// positionally to series in encoding.y order, so series `pos` uses
// colours[pos % len]. Editing one series materialises the palette into an
// explicit array; picking a preset replaces it wholesale.

const effectiveColors = computed(() =>
  (opts.colorScheme && opts.colorScheme.length) ? opts.colorScheme : ESPRESSO_PALETTE,
)
const hasCustomColors = computed(() => Array.isArray(opts.colorScheme) && opts.colorScheme.length > 0)

// Highlight the matching preset chip. With no override we're on the default
// (Espresso); an explicit array highlights whichever preset it equals, or none
// once the user hand-tweaks an individual series.
const activePaletteName = computed(() => {
  if (!hasCustomColors.value) return 'Espresso'
  const cur = opts.colorScheme
  const match = CHART_PALETTES.find(p =>
    p.colors.length === cur.length
    && p.colors.every((c, i) => c.toLowerCase() === String(cur[i]).toLowerCase()),
  )
  return match ? match.name : null
})

const selectedSeries = computed(() =>
  yCols.value.map((idx, pos) => ({
    idx,
    label: columns.value.find(c => c.idx === idx)?.label || `Column ${_colLetter(idx)}`,
    color: effectiveColors.value[pos % effectiveColors.value.length],
  })),
)

function applyPalette(p) {
  opts.colorScheme = [...p.colors]
}

function setSeriesColor(colIdx, hex) {
  const pos = yCols.value.indexOf(colIdx)
  if (pos < 0) return
  const base = (opts.colorScheme && opts.colorScheme.length)
    ? [...opts.colorScheme]
    : [...ESPRESSO_PALETTE]
  // Grow the array from the default palette so a high series index is still
  // addressable without leaving holes.
  while (base.length <= pos) base.push(ESPRESSO_PALETTE[base.length % ESPRESSO_PALETTE.length])
  base[pos] = hex
  opts.colorScheme = base
}

function resetColors() {
  opts.colorScheme = undefined
}

// ── Master "select all visible" checkbox ──────────────────────────────────-
//
// "Visible" = whatever passes the current filter (and isn't the X-axis).
// Tri-state label communicates "some selected" so users know clicking will
// extend vs. clear, even though the checkbox itself is binary.

const _selectableVisible = computed(() =>
  filteredColumns.value.filter(c => c.idx !== xCol.value),
)
const masterCheckState = computed(() => {
  const sel = _selectableVisible.value
  if (!sel.length) return 'none'
  const selectedHere = sel.filter(c => yCols.value.includes(c.idx)).length
  if (selectedHere === 0) return 'none'
  if (selectedHere === sel.length) return 'all'
  return 'some'
})
const masterCheckLabel = computed(() => {
  if (masterCheckState.value === 'all')  return seriesFilter.value ? 'Deselect visible' : 'Deselect all'
  if (masterCheckState.value === 'some') return 'Deselect visible'
  return seriesFilter.value ? 'Select visible' : 'Select all'
})

function toggleMasterSelection() {
  const visibleIdx = _selectableVisible.value.map(c => c.idx)
  if (masterCheckState.value === 'all') {
    // Drop only the visible ones — keep selections that are filtered out.
    yCols.value = yCols.value.filter(idx => !visibleIdx.includes(idx))
  } else {
    const merged = new Set(yCols.value)
    for (const idx of visibleIdx) merged.add(idx)
    yCols.value = [...merged].sort((a, b) => a - b)
  }
}

// ── Preview config (live) ──────────────────────────────────────────────────-

const previewConfig = computed(() => {
  if (!matrix.value.length || !yCols.value.length) return null
  return {
    chartType: chartType.value,
    title:     title.value,
    hasHeader: hasHeader.value,
    encoding:  { x: xCol.value, y: yCols.value },
    options:   { ...opts },
  }
})
const previewMatrix = computed(() => matrix.value)

// ── Confirm ────────────────────────────────────────────────────────────────-

const canCommit = computed(() =>
  !!previewConfig.value
  && !rangeError.value
  && rangeInput.value.trim().length > 0
)

function onConfirm() {
  if (!canCommit.value) return
  emit('confirm', {
    id:          props.chartId || undefined,
    sourceSheet: props.currentSheet,
    sourceRange: rangeInput.value.trim(),
    chartType:   chartType.value,
    title:       title.value,
    hasHeader:   hasHeader.value,
    encoding:    { x: xCol.value, y: [...yCols.value] },
    // JSON round-trip strips Vue reactivity — the engine's history snapshot
    // deep-clones configs with structuredClone, which throws DataCloneError on
    // any reactive proxy (e.g. options.colorScheme). This drops undefined keys,
    // which is exactly what we want (a missing colorScheme → default palette).
    options:     JSON.parse(JSON.stringify({ ...opts })),
  })
  show.value = false
}

function _label(t) {
  return t.charAt(0).toUpperCase() + t.slice(1)
}
function _colLetter(idx) {
  let n = idx + 1, s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

// Scan A1..AZ500 on the current sheet for the bounding box of non-empty
// cells, return it as "A1:<col><row>". Uses the raw `getCell` (not the
// formula-evaluating `getRangeValues`) so a literal 0 reads as data and an
// empty cell reads as empty. 500×52 ≈ 26k lookups — a fraction of a ms.
function _autoDetectRange() {
  if (!props.sheet?.getCell) return ''
  const sheetName = props.currentSheet
  const ROWS = 500, COLS = 52
  let maxRow = -1, maxCol = -1
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = props.sheet.getCell(_colLetter(c) + (r + 1), sheetName)
      if (v !== '' && v !== undefined && v !== null) {
        if (r > maxRow) maxRow = r
        if (c > maxCol) maxCol = c
      }
    }
  }
  if (maxRow < 0) return ''
  return `A1:${_colLetter(maxCol)}${maxRow + 1}`
}
</script>

<style scoped>
.cd-section { margin-bottom: 18px; }
.cd-label   { font-size: 11px; font-weight: 600; color: var(--ink-gray-6); text-transform: uppercase; letter-spacing: .04em; margin: 0 0 6px; }

.cd-range-row     { display: flex; align-items: center; gap: 10px; }
.cd-range-input   { flex: 1; }
/* FormControl(checkbox) renders its own label slot, so we only need
   `flex-shrink: 0` + bottom-alignment to keep it level with the Detect button. */
.cd-header-toggle { flex-shrink: 0; }
.cd-error         { font-size: 12px; color: var(--ink-red-5); margin: 4px 0 0; }
.cd-hint          { font-size: 11px; color: var(--ink-gray-5); margin: 5px 0 0; line-height: 1.4; }

.cd-type-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.cd-type-btn {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 12px 8px; cursor: pointer;
  background: var(--surface-base); border: 1px solid var(--outline-gray-2);
  border-radius: 8px; font: inherit; font-size: 12px; color: var(--ink-gray-7);
  transition: background .12s, border-color .12s, color .12s;
}
.cd-type-btn:hover { background: var(--surface-gray-2); border-color: var(--outline-gray-3); }
.cd-type-btn--active {
  background: var(--surface-gray-3);
  border-color: var(--outline-gray-4);
  color: var(--ink-gray-9);
  font-weight: 500;
}
.cd-type-icon { width: 18px; height: 18px; }

.cd-grid {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 18px;
  align-items: stretch;
  min-height: 380px;
}
.cd-encoding { display: flex; flex-direction: column; min-width: 0; }

.cd-series-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-bottom: 6px;
}
.cd-series-count {
  font-weight: 500; font-size: 11px; color: var(--ink-gray-5);
  margin-left: 6px; letter-spacing: 0;
}
.cd-series-filter { margin-bottom: 6px; }

.cd-series-list {
  border: 1px solid var(--outline-gray-2);
  border-radius: 8px;
  padding: 6px;
  max-height: 220px;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 2px;
}
.cd-series-row {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 6px; border-radius: 4px;
  font-size: 13px; color: var(--ink-gray-8); cursor: pointer;
}
.cd-series-row:hover { background: var(--surface-gray-2); }
/* Sticky master "Select / Deselect" row. The list scrolls under it, so the
   background must be fully opaque and the z-index high enough to keep
   subsequent rows behind. `top: -6px` cancels the negative margin so the
   row stays flush with the list's rounded top corner. A soft drop shadow
   doubles the visual separation so a scrolled-in row never appears to peek
   between the master's border and the first option below it. */
.cd-series-row--master {
  position: sticky; top: -6px;
  background: var(--surface-elevation-2, #fff);
  border-bottom: 1px solid var(--outline-gray-2);
  box-shadow: 0 2px 4px -2px rgba(0, 0, 0, .08);
  margin: -6px -6px 4px;
  padding: 8px 12px;
  border-top-left-radius: 8px; border-top-right-radius: 8px;
  z-index: 2;
}
.cd-series-row--master strong { color: var(--ink-gray-7); font-weight: 500; }
.cd-series-row--master:hover { background: var(--surface-gray-1); }
.cd-series-row--disabled { opacity: .5; cursor: not-allowed; }
.cd-series-row--disabled:hover { background: transparent; }
.cd-series-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-series-tag {
  font-size: 10px; padding: 1px 5px; border-radius: 3px;
  background: var(--surface-gray-2); color: var(--ink-gray-6); font-weight: 600;
}
.cd-series-empty {
  padding: 12px 6px; text-align: center;
  font-size: 12px; color: var(--ink-gray-5);
}

.cd-options { display: flex; flex-direction: column; gap: 4px; }

.cd-colors-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.cd-palettes { display: flex; flex-wrap: wrap; gap: 6px; }
.cd-palette {
  display: flex; overflow: hidden; cursor: pointer;
  height: 24px; width: 56px; padding: 0;
  background: none; border: 1px solid var(--outline-gray-2); border-radius: 6px;
  transition: border-color .12s, box-shadow .12s;
}
.cd-palette:hover { border-color: var(--outline-gray-3); }
.cd-palette--active { border-color: var(--outline-gray-4); box-shadow: 0 0 0 2px var(--surface-gray-3); }
.cd-palette-stop { flex: 1; }

.cd-series-colors { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.cd-series-color { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--ink-gray-8); min-width: 0; }
.cd-color-input {
  width: 22px; height: 22px; flex-shrink: 0; padding: 0;
  background: none; border: 1px solid var(--outline-gray-2); border-radius: 5px; cursor: pointer;
}
/* Native color input renders an inset swatch with default chrome padding —
   trim it so the whole control reads as one clean colour chip. */
.cd-color-input::-webkit-color-swatch-wrapper { padding: 2px; }
.cd-color-input::-webkit-color-swatch { border: none; border-radius: 3px; }
.cd-series-color-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cd-preview { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.cd-preview-frame {
  flex: 1;
  background: var(--surface-gray-1);
  border: 1px solid var(--outline-gray-2);
  border-radius: 8px;
  min-height: 320px;
  display: flex; align-items: stretch; justify-content: stretch;
  overflow: hidden;
  padding: 8px;
}
.cd-preview-frame > * { flex: 1; min-width: 0; min-height: 0; }
.cd-preview-placeholder {
  color: var(--ink-gray-5);
  font-size: 12px;
}
</style>
