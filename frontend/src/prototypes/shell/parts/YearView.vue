<!--
  PROTOTYPE — remove. Year view: twelve month grids.

  It is a navigation surface, not an event surface — a day carries only how busy
  it is, and clicking it hands the date back so the screen can open the week.
-->
<template>
  <ScrollArea class="min-h-0 flex-1">
    <div class="grid gap-x-8 gap-y-7 px-5 py-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      <section v-for="month in months" :key="month">
        <h3 class="pb-1 pl-1 text-base font-medium text-ink-gray-8">
          {{ monthName(month) }}
        </h3>
        <MonthGrid :month="month">
          <template #day="{ date, label, title, inMonth, isToday }">
            <Tooltip :text="tooltip(date)" :hover-delay="0.4">
              <button
                class="mx-auto flex flex-col items-center gap-px pt-1"
                :aria-label="`${title}${countLabel(date)}`"
                @click="emit('pick', date)"
              >
                <span
                  class="flex size-6 items-center justify-center rounded-full text-xs"
                  :class="dayClass(date, inMonth, isToday)"
                >
                  {{ label }}
                </span>
                <!-- The dot always occupies its row, busy or not, so no month
                     grid shifts by a pixel as you page through the year. -->
                <span
                  class="size-1 rounded-full"
                  :class="inMonth && count(date) ? 'bg-surface-gray-5' : 'bg-transparent'"
                />
              </button>
            </Tooltip>
          </template>
        </MonthGrid>
      </section>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ScrollArea, Tooltip } from 'frappe-ui'
import dayjs from 'dayjs'

import { EVENT_COUNT_BY_DATE } from '../calendarFixtures'
import MonthGrid from './MonthGrid.vue'

const props = defineProps<{ year: number }>()
const emit = defineEmits<{ pick: [date: string] }>()

const months = computed(() =>
  Array.from({ length: 12 }, (_, i) =>
    dayjs(`${props.year}-01-01`).month(i).format('YYYY-MM-DD'),
  ),
)

function monthName(month: string) {
  return dayjs(month).format('MMMM')
}

function count(date: string) {
  return EVENT_COUNT_BY_DATE[date] ?? 0
}

// Ink-first here too: a filled circle reads as "selected", so busyness is
// carried by weight and a dot under the number instead of a coloured chip.
// Days spilling in from the neighbouring month stay plain, so each grid reads
// as one month.
function dayClass(date: string, inMonth: boolean, isToday: boolean) {
  if (isToday) return 'bg-surface-gray-7 font-medium text-ink-gray-1'
  if (!inMonth) return 'text-ink-gray-3 hover:bg-surface-gray-2'
  return count(date)
    ? 'font-medium text-ink-gray-9 hover:bg-surface-gray-2'
    : 'text-ink-gray-6 hover:bg-surface-gray-2'
}

function countLabel(date: string) {
  const events = count(date)
  if (!events) return ''
  return `, ${events} ${events === 1 ? 'event' : 'events'}`
}

function tooltip(date: string) {
  return `${dayjs(date).format('ddd, D MMM')}${countLabel(date)}`
}
</script>
