<!--
  Calendar's own panel: the mini month, the calendars, and what is next.

  The calendar rows are real toggles — unchecking one drops its events from
  every view, because all three grids read the same `eventsBetween`.
-->
<template>
  <MiniMonth />

  <div class="mt-1 flex h-7 items-center justify-between">
    <SidebarLabel>My calendars</SidebarLabel>
    <Button variant="ghost" icon="lucide-plus" aria-label="New calendar" />
  </div>
  <div class="mt-0.5 space-y-0.5">
    <button
      v-for="cal in CALENDARS"
      :key="cal.id"
      type="button"
      class="flex h-7 w-full items-center gap-2 rounded-4 px-2 text-left transition hover:bg-surface-gray-2"
      @click="toggleCalendar(cal.id)"
    >
      <span class="grid size-4 shrink-0 place-items-center">
        <span
          class="size-2.5 rounded-full border"
          :class="isHidden(cal.id) ? 'border-outline-gray-3' : [cal.dot, 'border-transparent']"
        />
      </span>
      <span
        class="min-w-0 flex-1 truncate text-base"
        :class="isHidden(cal.id) ? 'text-ink-gray-4' : 'text-ink-gray-7'"
      >
        {{ cal.label }}
      </span>
    </button>
  </div>

  <div class="mt-3 flex h-7 items-center">
    <SidebarLabel>Upcoming</SidebarLabel>
  </div>
  <div v-if="upcoming.length" class="mt-0.5 space-y-0.5">
    <button
      v-for="event in upcoming"
      :key="event.id"
      type="button"
      class="flex w-full flex-col gap-0.5 rounded-4 px-2 py-1.5 text-left transition hover:bg-surface-gray-2"
      @click="goToDate(event.start)"
    >
      <span class="flex min-w-0 items-center gap-2">
        <span class="size-2 shrink-0 rounded-full" :class="event.dot" />
        <span class="min-w-0 truncate text-base text-ink-gray-8">{{ event.title }}</span>
      </span>
      <span class="pl-4 text-xs text-ink-gray-5">{{ whenLabel(event) }}</span>
    </button>
  </div>
  <div v-else class="flex flex-col items-start gap-1 px-2 py-3">
    <span class="text-base text-ink-gray-6">No upcoming events</span>
    <span class="text-p-sm text-ink-gray-5">Your schedule is clear. Enjoy the calm.</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button, SidebarLabel } from 'frappe-ui'
import dayjs from 'dayjs'

import { ISO, today } from '../../calendarDates'
import {
  CALENDARS,
  CALENDAR_EVENTS,
  hiddenCalendars,
  isAllDay,
  toggleCalendar,
  type CalEvent,
  type CalendarId,
} from '../../calendarFixtures'
import { goToDate } from '../../calendarState'
import MiniMonth from '../MiniMonth.vue'

function isHidden(id: CalendarId) {
  return hiddenCalendars.value.includes(id)
}

// The next few from today, hidden calendars left out, so the list agrees with
// the grid beside it.
const upcoming = computed(() => {
  const from = today()
  return CALENDAR_EVENTS.filter(
    (event) => event.end >= from && !hiddenCalendars.value.includes(event.calendar),
  )
    .sort((a, b) => a.start.localeCompare(b.start) || (a.startMin ?? 0) - (b.startMin ?? 0))
    .slice(0, 5)
})

function whenLabel(event: CalEvent) {
  const day = dayjs(event.start)
  const dayLabel = day.format(ISO) === today() ? 'Today' : day.format('ddd D MMM')
  if (isAllDay(event)) return `${dayLabel} · All day`
  const start = dayjs().startOf('day').add(event.startMin as number, 'minute')
  return `${dayLabel} · ${start.format('HH:mm')}`
}
</script>
