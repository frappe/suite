<template>
  <TimeMenu
    v-model:open="open"
    :choices="reminderChoices"
    :title
    :choices-heading="current ? __('Change to') : undefined"
    :action="__('Remind me')"
    :past-message="__('Choose a time after the mail goes out.')"
    :initial-value="current"
    :footer
    @pick="(at: string) => emit('pick', at)"
  >
    <!-- Only a trigger that is there: without one, it opens by v-model:open alone. -->
    <template v-if="$slots.default" #default><slot /></template>
  </TimeMenu>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import TimeMenu from '@/apps/mail/components/TimeMenu.vue'
import { describeReminderTime, useMinuteClock } from '@/apps/mail/utils/datetime'
import { reminderChoices } from '@/apps/mail/utils/snoozeTimes'

const { current, removable } = defineProps<{
  // The time it is set for now, when it is being changed.
  current?: string
  // The menu is also the way to take the reminder off.
  removable?: boolean
}>()

const emit = defineEmits<{ pick: [at: string]; remove: [] }>()
const open = defineModel<boolean>('open', { default: false })

// A reminder already set heads the menu with its time, so opening it again says when it is.
const now = useMinuteClock()
const title = computed(() =>
  current ? describeReminderTime(current, now.value) : __('Remind me if no reply'),
)
const footer = computed(() =>
  removable
    ? {
        label: __('Remove reminder'),
        onClick: () => emit('remove'),
        theme: 'red' as const,
      }
    : undefined,
)
</script>
