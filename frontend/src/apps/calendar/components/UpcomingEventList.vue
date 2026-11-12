<script setup lang="ts">
import { Avatar, Button } from 'frappe-ui'
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import type { UpcomingEventRow } from './upcomingEventRow'

const props = defineProps<{ events: readonly UpcomingEventRow[]; currentUser?: string }>()
defineEmits<{ select: [event: UpcomingEventRow] }>()
const participantsByEvent = computed(
  () =>
    new Map(
      props.events.map((event) => {
        const participants = [
          ...new Map(
            (event.participants || []).map((participant) => [
              participant.email.toLowerCase(),
              participant,
            ]),
          ).values(),
        ]
        const onlyYou =
          participants.length === 1 &&
          participants[0]?.email.toLowerCase() === props.currentUser?.toLowerCase()
        return [event.id, onlyYou ? [] : participants]
      }),
    ),
)
</script>

<template>
  <div class="overflow-hidden rounded-7 border border-outline-gray-1 bg-surface-gray-1">
    <Button
      v-for="event in events"
      :key="event.id"
      class="upcoming-event"
      variant="ghost"
      :href="event.href"
      :route="event.route"
      :aria-label="event.actionLabel"
      @click="$emit('select', event)"
    >
      <span class="flex w-full min-w-0 items-center gap-2.5">
        <span
          class="flex size-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-6 border border-outline-gray-1 bg-surface-base p-1"
        >
          <span class="text-xs font-medium leading-none capitalize text-ink-red-5">{{
            event.month
          }}</span>
          <span class="text-md font-medium leading-none text-ink-gray-7">{{ event.day }}</span>
        </span>
        <span class="min-w-0 flex-1 text-start">
          <span class="block truncate text-sm font-medium text-ink-gray-8">{{ event.title }}</span>
          <span class="mt-1.5 flex min-w-0 items-center gap-0.5 text-sm text-ink-gray-6">
            <span class="shrink-0">{{ event.time }}</span>
            <template v-if="participantsByEvent.get(event.id)?.length">
              <span aria-hidden="true">{{ '・' }}</span>
              <span class="flex items-center -space-x-2" :aria-label="__('Invited people')">
                <span
                  v-for="participant in participantsByEvent.get(event.id)?.slice(0, 5)"
                  :key="participant.email"
                  :title="participant.name"
                  class="flex size-5 shrink-0"
                >
                  <Avatar
                    class="size-5 rounded-full border-2 border-outline-gray-1"
                    :image="participant.image"
                    :label="participant.name"
                  />
                </span>
                <span
                  v-if="(participantsByEvent.get(event.id)?.length || 0) > 5"
                  class="flex size-5 items-center justify-center rounded-full border-2 border-outline-gray-1 bg-surface-gray-2 text-xs text-ink-gray-5"
                  :title="
                    participantsByEvent
                      .get(event.id)
                      ?.slice(5)
                      .map((participant) => participant.name)
                      .join(', ')
                  "
                  >{{ (participantsByEvent.get(event.id)?.length || 0) - 5 }}+</span
                >
              </span>
            </template>
          </span>
        </span>
      </span>
    </Button>
  </div>
</template>

<style scoped>
.upcoming-event {
  @apply h-[66px] w-full rounded-none border-outline-gray-1 px-2.5 py-2.5 hover:bg-surface-gray-2;
}
.upcoming-event:not(:last-child) {
  @apply border-b;
}
.upcoming-event :deep(> span) {
  @apply w-full;
}
</style>
