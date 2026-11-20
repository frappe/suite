<template>
  <!-- The month a booker picks a day from. Only days with a free slot can be picked; the rest
       of the month stays as numbers for orientation, and the neighbouring months' days are
       left out, so a day that looks pickable always is. Six rows always, from the shared month
       grid, so paging never moves the slots beside it. -->
  <div>
    <div class="mb-3 flex items-center gap-1">
      <h2 class="flex-1 text-base-medium text-ink-gray-9">{{ title }}</h2>
      <Button
        variant="ghost"
        icon="lucide-chevron-left"
        :aria-label="__('Previous month')"
        :disabled="!canGoBack"
        @click="emit('page', -1)"
      />
      <Button
        variant="ghost"
        icon="lucide-chevron-right"
        :aria-label="__('Next month')"
        :disabled="!canGoForward"
        @click="emit('page', 1)"
      />
    </div>
    <div class="grid grid-cols-7 gap-y-1 justify-items-center">
      <span
        v-for="letter in weekdays"
        :key="letter.key"
        class="pb-1 text-xs text-ink-gray-5"
        aria-hidden="true"
      >
        {{ letter.label }}
      </span>
      <template v-for="day in days" :key="day.key">
        <button
          v-if="day.inMonth"
          type="button"
          class="relative flex size-10 items-center justify-center rounded-full text-base"
          :class="
            day.key === selected
              ? 'bg-surface-gray-9 font-medium text-ink-base'
              : free.has(day.key)
                ? 'bg-surface-gray-2 font-medium text-ink-gray-9 hover:bg-surface-gray-3 active:bg-surface-gray-4'
                : 'cursor-default text-ink-gray-4'
          "
          :disabled="!free.has(day.key)"
          :aria-label="dayLabel(day.key)"
          :aria-pressed="day.key === selected"
          :aria-current="day.key === today ? 'date' : undefined"
          @click="emit('select', day.key)"
        >
          {{ day.date.date() }}
          <span
            v-if="day.key === today"
            class="absolute bottom-1.5 size-1 rounded-full bg-current"
            aria-hidden="true"
          />
        </button>
        <span v-else class="size-10" aria-hidden="true" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed } from 'vue'

import type { Month } from '@/apps/calendar/booking/internal/slotDays'
import { monthDays } from '@/apps/calendar/composables/useMonthGrid'
import { translate as __ } from '@/platform/translation'

const props = defineProps<{
  month: Month
  /** Dates, `YYYY-MM-DD` in the booker's zone, that have a free slot. */
  free: ReadonlySet<string>
  selected?: string
  /** Today in the booker's zone. */
  today: string
  canGoBack: boolean
  canGoForward: boolean
}>()

const emit = defineEmits<{ select: [day: string]; page: [months: -1 | 1] }>()

const days = monthDays(
  () => props.month.month,
  () => props.month.year,
  [],
)

// Dates here are calendar dates, not instants, so they are formatted as UTC.
const utcDate = (key: string) => new Date(`${key}T00:00:00Z`)

const title = computed(() =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(props.month.year, props.month.month, 1)),
  ),
)

// 2026-11-01 is a Sunday, the grid's first column.
const weekdays = Array.from({ length: 7 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 10, 1 + index))
  return {
    key: index,
    label: new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' }).format(date),
  }
})

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})
const dayLabel = (key: string) => dayFormat.format(utcDate(key))
</script>
