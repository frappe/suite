<!--
  PROTOTYPE — remove. Sidebar month picker. It follows the main view's visible
  range, and clicking a day moves the main view to it.

  Its own arrows only page this grid, so browsing ahead never disturbs the
  screen behind it — the way Google Calendar's mini month behaves.
-->
<template>
  <!-- No horizontal padding: the sidebar's scroll viewport already owns the
       px-2 gutter. -->
  <div class="py-2">
    <div class="flex items-center justify-between pb-1 pl-1">
      <span class="text-sm font-medium text-ink-gray-8">{{ monthLabel }}</span>
      <div class="flex items-center">
        <Button variant="ghost" size="sm" icon="lucide-chevron-left" @click="page(-1)" />
        <Button variant="ghost" size="sm" icon="lucide-chevron-right" @click="page(1)" />
      </div>
    </div>

    <MonthGrid :month="cursor">
      <template #day="{ date, label, title, inMonth, isToday }">
        <button
          class="mx-auto flex size-6 items-center justify-center rounded-full text-xs"
          :class="dayClass(date, inMonth, isToday)"
          :aria-label="title"
          @click="goToDate(date)"
        >
          {{ label }}
        </button>
      </template>
    </MonthGrid>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button } from 'frappe-ui'
import dayjs from 'dayjs'

import { goToDate, visibleRange } from '../calendarState'
import MonthGrid from './MonthGrid.vue'

const cursor = ref(visibleRange.value.start)

// Follow the main view, but only when it lands on a different month — else
// every step inside one month would yank the grid back after the user paged it.
// A range wider than a month is the Year view, which has no month to follow:
// snapping to its 1 January would throw away where the user actually is.
watch(
  () => visibleRange.value,
  ({ start, end }) => {
    if (dayjs(end).diff(start, 'day') > 31) return
    if (!dayjs(start).isSame(cursor.value, 'month')) cursor.value = start
  },
)

const monthLabel = computed(() => dayjs(cursor.value).format('MMMM YYYY'))

function page(delta: number) {
  cursor.value = dayjs(cursor.value).add(delta, 'month').format('YYYY-MM-DD')
}

// Shading the range only pays off for a week. In Month view it would tint the
// whole grid, which says nothing and buries today.
const shadeRange = computed(() => {
  const { start, end } = visibleRange.value
  return dayjs(end).diff(start, 'day') <= 7
})

function dayClass(date: string, inMonth: boolean, isToday: boolean) {
  if (isToday) return 'bg-surface-gray-7 font-medium text-ink-gray-1'
  const { start, end } = visibleRange.value
  if (shadeRange.value && date >= start && date <= end) {
    return 'bg-surface-gray-3 text-ink-gray-8'
  }
  return inMonth ? 'text-ink-gray-7 hover:bg-surface-gray-2' : 'text-ink-gray-3 hover:bg-surface-gray-2'
}
</script>
