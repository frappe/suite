import { useResizeObserver } from '@vueuse/core'
import { computed, onMounted, ref, shallowRef, watch, type Ref } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'

import {
  fitColumns,
  FITTED_WIDTHS,
  isMeasuredColumn,
  LIST_COLUMNS,
  MEASURED_COLUMNS,
  measuredWidth,
  WIDE_ONLY,
  type MeasuredColumn,
} from './listColumns'
import type { FilesColumn } from './presentation'

/**
 * The list's column layout: the chosen columns in the rows' order, each
 * measured column sized to its widest label, and the columns that fit the
 * listing's width. Bind `ruler` to the element that holds `rulerLabels`.
 * Call it in a component's setup.
 */
export function useListColumns(options: {
  listing: Ref<HTMLElement | null>
  chosen: () => readonly FilesColumn[]
  rows: () => readonly DriveNode[]
  /** What a row's measured column says, or `null` when it says nothing. */
  labelOf: (column: MeasuredColumn, row: DriveNode) => string | null
}) {
  const shownColumns = computed(() =>
    LIST_COLUMNS.filter((column) => options.chosen().includes(column)),
  )
  /** The listing's width, once the browser has measured it. */
  const listingWidth = shallowRef<number>()
  useResizeObserver(options.listing, ([entry]) => (listingWidth.value = entry?.contentRect.width))
  /** The measured columns' widths, from their widest labels. */
  const measured = shallowRef<Partial<Record<MeasuredColumn, number>>>({})

  function trackWidth(column: FilesColumn) {
    if (isMeasuredColumn(column)) return measured.value[column] ?? MEASURED_COLUMNS[column].max
    return FITTED_WIDTHS[column]
  }

  /**
   * The columns the desktop layout shows. A chosen column the list has no room
   * for is hidden until there is room again; it stays chosen.
   */
  const desktopColumns = computed(() => {
    const width = listingWidth.value
    if (width === undefined) return shownColumns.value
    return fitColumns(shownColumns.value, width, trackWidth)
  })

  /** Each shown measured column's labels in the rows, once each. */
  const rulerLabels = computed(() => {
    const labels: Partial<Record<MeasuredColumn, string[]>> = {}
    for (const column of shownColumns.value.filter(isMeasuredColumn)) {
      const found = options.rows().flatMap((row) => options.labelOf(column, row) ?? [])
      labels[column] = [...new Set(found)]
    }
    return labels
  })

  const ruler = ref<HTMLElement | null>(null)
  watch([rulerLabels, ruler], measureColumns, { flush: 'post', immediate: true })
  // Labels measured before the web font loads have the fallback font's widths.
  onMounted(() => void document.fonts?.ready.then(measureColumns))

  /** Sizes each measured column to its widest label. A label with no width has had no layout, so it says nothing. */
  function measureColumns() {
    const next = { ...measured.value }
    for (const column of LIST_COLUMNS.filter(isMeasuredColumn)) {
      const group = ruler.value?.querySelector(`[data-column="${column}"]`)
      if (!group) continue
      const widths = [...group.children].map((label) => label.getBoundingClientRect().width)
      if (widths.some(Boolean)) next[column] = measuredWidth(column, widths.filter(Boolean))
    }
    measured.value = next
  }

  const tracks = computed(() => {
    const of = (list: FilesColumn[]) => [
      'minmax(0,1fr)',
      ...list.map((column) => `${trackWidth(column)}px`),
      '2.5rem',
    ]
    return {
      base: of(shownColumns.value.filter((column) => !WIDE_ONLY.has(column))),
      md: of(desktopColumns.value),
    }
  })

  /** Hides a chosen column the phone layout, the desktop layout or both leave out. */
  function columnClass(column: FilesColumn) {
    const onDesktop = desktopColumns.value.includes(column)
    if (!WIDE_ONLY.has(column)) return onDesktop ? undefined : 'md:hidden'
    return onDesktop ? 'hidden md:flex' : 'hidden'
  }

  return { shownColumns, tracks, columnClass, rulerLabels, ruler }
}
