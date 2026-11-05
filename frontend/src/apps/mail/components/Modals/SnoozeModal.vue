<template>
  <ScheduleSendModal
    v-model="show"
    :title="initialValue ? __('Change snooze time') : __('Snooze until')"
    :action="__('Snooze')"
    :past-message="__('Choose a time in the future.')"
    :failed-message="__('Could not snooze.')"
    :presets="snoozeChoices"
    :initial-value
    :save
  />
</template>

<script setup lang="ts">
import ScheduleSendModal from '@/apps/mail/components/Modals/ScheduleSendModal.vue'
import { snoozeChoices } from '@/apps/mail/utils/snoozeTimes'

const show = defineModel<boolean>()

defineProps<{
  save: (until: string) => Promise<unknown>
  // The time it is snoozed until now, when it is being changed.
  initialValue?: string
}>()
</script>
