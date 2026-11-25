<template>
  <ReminderMenu
    :current="remindAt"
    :removable="!!remindAt"
    @pick="(at: string) => emit('remind', at)"
    @remove="emit('clear')"
  >
    <Button
      variant="ghost"
      class="max-h-6 max-w-6 shrink-0"
      :class="{ '!bg-surface-gray-3': remindAt }"
      :aria-label="label"
      :tooltip="label"
    >
      <template #icon>
        <span
          :class="remindAt ? 'lucide-bell' : 'lucide-bell-plus'"
          class="text-ink-gray-8 size-4"
          aria-hidden="true"
        />
      </template>
    </Button>
  </ReminderMenu>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed } from 'vue'

import ReminderMenu from '@/apps/mail/components/ReminderMenu.vue'
import { describeReminderTime, useMinuteClock } from '@/apps/mail/utils/datetime'

const { remindAt } = defineProps<{
  // When to be reminded if nobody replies, once asked for.
  remindAt?: string
}>()

const emit = defineEmits<{ remind: [at: string]; clear: [] }>()

const now = useMinuteClock()
const label = computed(() =>
  remindAt ? describeReminderTime(remindAt, now.value) : __('Remind me if no reply'),
)
</script>
