<!--
  PROTOTYPE — remove. Month grid in the same ink-first language as the week:
  a dot carries the calendar, the title is ink, nothing is filled.

  Rows share the height evenly and each cell caps its list, so a busy week
  cannot stretch the grid past the viewport.
-->
<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="grid shrink-0 grid-cols-7 border-b border-outline-gray-1">
      <span
        v-for="(label, i) in WEEKDAYS"
        :key="i"
        class="py-2 text-center text-2xs text-ink-gray-5"
      >
        {{ label }}
      </span>
    </div>

    <div class="grid min-h-0 flex-1 auto-rows-fr">
      <div
        v-for="(week, w) in weeks"
        :key="w"
        class="grid min-h-0 grid-cols-7 border-b border-outline-gray-1 last:border-b-0"
      >
        <div
          v-for="day in week"
          :key="day.key"
          class="flex min-h-0 flex-col gap-0.5 px-1 pb-1 pt-1.5"
        >
          <button
            class="mx-auto flex size-6 shrink-0 items-center justify-center rounded-full text-xs"
            :class="
              day.isToday
                ? 'bg-surface-gray-7 font-medium text-ink-gray-1'
                : day.inMonth
                  ? 'text-ink-gray-7 hover:bg-surface-gray-2'
                  : 'text-ink-gray-4 hover:bg-surface-gray-2'
            "
            :aria-label="day.title"
            @click="emit('pick', day.key)"
          >
            {{ day.date }}
          </button>

          <Popover
            v-for="event in day.shown"
            :key="event.id"
            side="right"
            align="start"
            arrow
          >
            <template #trigger>
              <button
                class="flex h-5 w-full min-w-0 shrink-0 items-center gap-1.5 rounded-1 px-1 text-left hover:bg-surface-gray-2"
              >
                <span class="size-1.5 shrink-0 rounded-full" :class="event.dot" />
                <span class="truncate text-xs text-ink-gray-8">{{ event.title }}</span>
              </button>
            </template>
            <EventDetails :event="event" />
          </Popover>

          <button
            v-if="day.hidden"
            class="shrink-0 px-1 text-left text-2xs text-ink-gray-5 hover:text-ink-gray-7"
            @click="emit('pick', day.key)"
          >
            {{ day.hidden }} more
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Popover } from 'frappe-ui'

import { ISO, monthMatrix, today } from '../calendarDates'
import { eventsBetween, isAllDay } from '../calendarFixtures'
import EventDetails from './EventDetails.vue'

const props = defineProps<{
  /** Any date inside the month to show. */
  date: string
}>()
const emit = defineEmits<{ pick: [date: string] }>()

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Six-week months would overflow at three events per cell; five fit two. */
const MAX_PER_DAY = 3

const matrix = computed(() => monthMatrix(props.date))

const weeks = computed(() => {
  const first = matrix.value[0][0].format(ISO)
  const last = matrix.value.at(-1)!.at(-1)!.format(ISO)
  const events = eventsBetween(first, last)
  const month = props.date.slice(0, 7)
  const perRow = matrix.value.length > 5 ? MAX_PER_DAY - 1 : MAX_PER_DAY
  const todayKey = today()

  return matrix.value.map((week) =>
    week.map((day) => {
      const key = day.format(ISO)
      // All-day spans come first: they set the shape of the day, and a timed
      // event slotted above a trip reads as the more important of the two.
      const onDay = events
        .filter((e) => e.start <= key && e.end >= key)
        .sort((a, b) => {
          if (isAllDay(a) !== isAllDay(b)) return isAllDay(a) ? -1 : 1
          return (a.startMin ?? 0) - (b.startMin ?? 0)
        })

      return {
        key,
        date: day.date(),
        title: day.format('dddd, D MMMM YYYY'),
        inMonth: key.slice(0, 7) === month,
        isToday: key === todayKey,
        shown: onDay.slice(0, perRow),
        hidden: Math.max(onDay.length - perRow, 0),
      }
    }),
  )
})
</script>
