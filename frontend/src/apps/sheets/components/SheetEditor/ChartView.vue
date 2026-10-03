<template>
  <div class="cv-wrap" :style="_wrapStyle">
    <VChart
      v-if="option"
      :key="config.chartType"
      class="cv-chart"
      :option="option"
      :update-options="UPDATE_OPTS"
      autoresize
    />
    <div v-else class="cv-empty">No data</div>
  </div>
</template>

<script setup>
// Thin presentational wrapper around `vue-echarts`. Receives a ChartConfig
// and a matrix of source values; converts them to an ECharts option via
// `engine/chart-data.js`. Everything reactive — when the matrix or config
// changes, ECharts diff-updates in place.
//
// We lazy-register only the chart types we actually use so the bundle
// doesn't drag in the full ECharts library.

import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { use as echartsUse } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'

import { buildOption } from '../../engine/chart-data.js'

// Width/height accept either a pixel number (overlay charts get a fixed
// frame) or the string "auto" (preview / responsive contexts where the
// parent controls layout via flex/grid). Echarts `autoresize` handles the
// reflow in both cases.
const _toCssDim = (v) => (v === 'auto' || v == null ? '100%' : typeof v === 'number' ? v + 'px' : v)

// One-time global registration. Idempotent — repeated calls are no-ops.
echartsUse([
  CanvasRenderer,
  LineChart,
  BarChart,
  PieChart,
  ScatterChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DataZoomComponent,
])

// `vue-echarts` is itself heavy; lazy-load the component so editor mount
// doesn't pay for it when no charts exist on the sheet.
const VChart = defineAsyncComponent(() => import('vue-echarts'))

const props = defineProps({
  config: { type: Object, required: true },
  matrix: { type: Array, default: () => [] },
  width: { type: [Number, String], default: 480 },
  height: { type: [Number, String], default: 320 },
})

const _wrapStyle = computed(() => ({
  width: _toCssDim(props.width),
  height: _toCssDim(props.height),
}))

const isDark = ref(
  typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark',
)

let _themeObserver = null

onMounted(() => {
  const checkDark = () => {
    isDark.value = document.documentElement.getAttribute('data-theme') === 'dark'
  }
  checkDark()
  if (typeof MutationObserver !== 'undefined') {
    _themeObserver = new MutationObserver(checkDark)
    _themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
  }
})

// `notMerge: true` clears component-level state (axes / legend) on every
// setOption. Combined with the `:key="config.chartType"` on <VChart>
// (which forces a fresh ECharts instance whenever the type changes), this
// guarantees switches like bar → area don't leave residual series of the
// previous type behind — a class of bug ECharts is famously fiddly about
// when series.type alone is mutated in place.
const UPDATE_OPTS = { notMerge: true, lazyUpdate: false }

const option = shallowRef(null)
let _rafId = 0

// Throttle to one option rebuild per frame — formula recalcs can fire
// dozens of cell updates in a tight loop during paste / import.
// Explicit watch() (not watchEffect) so reactive deps are tracked from the
// sync getter; reading them inside the rAF callback alone would leave the
// effect with zero deps after first run, and option toggles would silently
// stop propagating to ECharts.
watch(
  [() => props.config, () => props.matrix, isDark],
  () => {
    cancelAnimationFrame(_rafId)
    _rafId = requestAnimationFrame(() => {
      option.value = buildOption(props.config, props.matrix, isDark.value)
    })
  },
  { immediate: true, deep: true },
)

onBeforeUnmount(() => {
  cancelAnimationFrame(_rafId)
  _themeObserver?.disconnect()
})
</script>

<style scoped>
.cv-wrap {
  position: relative;
  background: var(--surface-base, #ffffff);
  border-radius: 8px;
  overflow: hidden;
}
.cv-chart {
  width: 100%;
  height: 100%;
}
.cv-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--ink-gray-4, #a3a3a3);
  font:
    12px/1 InterVar,
    Inter,
    ui-sans-serif,
    system-ui,
    sans-serif;
}
</style>
