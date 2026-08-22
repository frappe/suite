<!--
  PROTOTYPE — remove. Panel body shown when an event is clicked.

  Everything sits on one left edge. The calendar's colour rides on the calendar
  row as a badge, not beside the title, so no line has to be indented past it.
-->
<template>
  <div class="flex w-80 flex-col gap-4 p-3">
    <div class="flex flex-col gap-1">
      <span class="text-base font-medium leading-5 text-ink-gray-9">
        {{ event.title }}
      </span>
      <span class="text-xs leading-4 text-ink-gray-6">{{ when }}</span>
    </div>

    <div v-if="rows.length" class="flex flex-col gap-2">
      <div v-for="row in rows" :key="row.key" class="flex items-center gap-2">
        <!-- The badge sits in a box the size of an icon, so both kinds of
             row put their text on the same left edge. -->
        <span v-if="row.key === 'calendar'" class="flex size-3.5 shrink-0 items-center justify-center">
          <span class="size-2.5 rounded-1" :class="event.dot" aria-hidden="true" />
        </span>
        <span
          v-else
          class="size-3.5 shrink-0 text-ink-gray-5"
          :class="row.icon"
          aria-hidden="true"
        />
        <span class="truncate text-xs text-ink-gray-7">{{ row.value }}</span>
      </div>
    </div>

    <div class="flex gap-2">
      <Button v-if="event.venue === 'Meet'" variant="solid" label="Join" icon-left="lucide-video" />
      <Button variant="subtle" label="Edit" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button } from 'frappe-ui'
import dayjs from 'dayjs'

import { formatTime } from '../calendarDates'
import { CALENDARS, isAllDay, type CalEvent } from '../calendarFixtures'

const props = defineProps<{ event: CalEvent }>()

const when = computed(() => {
  const { event } = props
  const day = dayjs(event.start).format('dddd, D MMMM')

  if (isAllDay(event)) {
    if (event.start === event.end) return `${day} · All day`
    return `${dayjs(event.start).format('D MMM')} – ${dayjs(event.end).format('D MMM')}`
  }
  return `${day} · ${formatTime(event.startMin!)} – ${formatTime(event.endMin!)}`
})

const rows = computed(() =>
  [
    { key: 'participant', icon: 'lucide-users', value: props.event.participant },
    { key: 'venue', icon: 'lucide-map-pin', value: props.event.venue },
    {
      key: 'calendar',
      icon: 'lucide-calendar',
      value: CALENDARS.find((c) => c.id === props.event.calendar)?.label ?? '',
    },
  ].filter((row) => row.value),
)
</script>
