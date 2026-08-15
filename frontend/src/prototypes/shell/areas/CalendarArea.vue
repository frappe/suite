<!-- PROTOTYPE — remove. Fake Calendar week grid with the 4 fixture events. -->
<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-12 shrink-0 items-center justify-between border-b border-outline-gray-1 px-5">
      <span class="text-base font-medium text-ink-gray-9">August 10 – 16, 2026</span>
      <Button label="Today" variant="outline" />
    </div>

    <!-- Day header row -->
    <div class="grid shrink-0 grid-cols-[3rem_repeat(7,1fr)] border-b border-outline-gray-1">
      <div />
      <div
        v-for="day in WEEK_DAYS"
        :key="day.label"
        class="flex items-center justify-center gap-1.5 border-l border-outline-gray-1 py-2"
      >
        <span class="text-sm text-ink-gray-5">{{ day.label }}</span>
        <span
          class="flex size-6 items-center justify-center rounded-full text-sm"
          :class="
            day.today
              ? 'bg-surface-gray-7 font-medium text-ink-gray-1'
              : 'text-ink-gray-8'
          "
        >
          {{ day.date }}
        </span>
      </div>
    </div>

    <!-- Hour grid -->
    <ScrollArea class="min-h-0 flex-1">
      <div class="grid grid-cols-[3rem_repeat(7,1fr)]">
        <!-- Time labels -->
        <div class="flex flex-col">
          <div
            v-for="hour in HOURS"
            :key="hour"
            class="flex h-12 items-start justify-end pr-2"
          >
            <span class="-mt-1.5 text-2xs text-ink-gray-4">{{ hour }}:00</span>
          </div>
        </div>
        <!-- Day columns -->
        <div
          v-for="(day, dayIndex) in WEEK_DAYS"
          :key="day.label"
          class="relative border-l border-outline-gray-1"
          :class="day.today ? 'bg-surface-gray-1' : ''"
        >
          <div
            v-for="hour in HOURS"
            :key="hour"
            class="h-12 border-t border-outline-gray-1"
          />
          <button
            v-for="event in eventsForDay(dayIndex)"
            :key="event.id"
            class="absolute inset-x-1 flex flex-col overflow-hidden rounded-4 border-l-2 border-outline-blue-5 bg-surface-blue-2 px-1.5 py-1 text-left"
            :style="eventStyle(event)"
          >
            <span class="flex items-center gap-1 truncate text-xs font-medium text-ink-blue-7">
              <span v-if="event.meet" class="lucide-video size-3 shrink-0" aria-hidden="true" />
              <span class="truncate">{{ event.title }}</span>
            </span>
            <span class="truncate text-2xs text-ink-blue-7">{{ event.time }}</span>
          </button>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { Button, ScrollArea } from 'frappe-ui'

import { UPCOMING_EVENTS, WEEK_DAYS, type UpcomingEvent } from '../fixtures'

/** Grid runs 8:00–18:00, one hour = 3rem (h-12). */
const HOURS = Array.from({ length: 10 }, (_, i) => i + 8)

function eventsForDay(dayIndex: number) {
  return UPCOMING_EVENTS.filter((e) => e.dayIndex === dayIndex)
}

function eventStyle(event: UpcomingEvent) {
  return {
    top: `${(event.startHour - 8) * 3}rem`,
    height: `${(event.endHour - event.startHour) * 3}rem`,
  }
}
</script>
