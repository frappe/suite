<!-- PROTOTYPE — remove. Panel body shown when an event is clicked. -->
<template>
  <div class="flex w-64 flex-col gap-3 p-1">
    <div class="flex gap-2">
      <span class="mt-1.5 size-1.5 shrink-0 rounded-full" :class="event.dot" />
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="text-p-base font-medium text-ink-gray-9">{{ event.title }}</span>
        <span class="text-p-xs text-ink-gray-6">{{ when }}</span>
      </div>
    </div>

    <div v-if="rows.length" class="flex flex-col gap-1.5 pl-3.5">
      <div v-for="row in rows" :key="row.icon" class="flex items-center gap-2">
        <span class="size-3.5 shrink-0 text-ink-gray-5" :class="row.icon" aria-hidden="true" />
        <span class="truncate text-xs text-ink-gray-7">{{ row.value }}</span>
      </div>
    </div>

    <div class="flex gap-1 pl-3.5">
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
    { icon: 'lucide-users', value: props.event.participant },
    { icon: 'lucide-map-pin', value: props.event.venue },
    {
      icon: 'lucide-calendar',
      value: CALENDARS.find((c) => c.id === props.event.calendar)?.label ?? '',
    },
  ].filter((row) => row.value),
)
</script>
