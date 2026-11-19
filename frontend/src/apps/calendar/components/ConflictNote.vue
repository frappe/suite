<script setup lang="ts">
import { CalendarClock } from 'lucide-vue-next'
import { computed } from 'vue'

import { conflictWhen } from '@/apps/calendar/composables/useAvailability'
import type { BusyCandidate } from '@/apps/calendar/utils/availability'

/** The writer's own events in the form's time, earliest first. */
const { conflicts } = defineProps<{ conflicts: (BusyCandidate & { title?: string | null })[] }>()

const text = computed(() => {
  const [first, ...rest] = conflicts
  if (!first) return ''
  const title = first.title || __('Untitled event')
  return rest.length
    ? __('Overlaps {0}, {1}, and {2} more', [title, conflictWhen(first), rest.length])
    : __('Overlaps {0}, {1}', [title, conflictWhen(first)])
})
</script>

<template>
  <!-- A note, not a warning: it never stops a save, and an overlap is often meant. -->
  <p v-if="text" class="flex items-start gap-1.5 text-p-sm text-ink-amber-7" role="status">
    <CalendarClock class="mt-0.5 size-3.5 shrink-0" :stroke-width="1.5" />
    <span class="min-w-0">{{ text }}</span>
  </p>
</template>
