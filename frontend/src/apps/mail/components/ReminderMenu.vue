<template>
  <TimeMenu
    v-model:open="open"
    :choices="reminderChoices"
    :title="current ? __('Change reminder') : __('Remind me if no reply')"
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
import { reminderChoices } from '@/apps/mail/utils/snoozeTimes'

const { removable } = defineProps<{
  // The time it is set for now, when it is being changed.
  current?: string
  // The menu is also the way to take the reminder off.
  removable?: boolean
}>()

const emit = defineEmits<{ pick: [at: string]; remove: [] }>()
const open = defineModel<boolean>('open', { default: false })

const footer = computed(() =>
  removable ? { label: __('Remove reminder'), onClick: () => emit('remove') } : undefined,
)
</script>
