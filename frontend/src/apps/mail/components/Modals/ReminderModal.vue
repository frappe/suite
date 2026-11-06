<template>
  <ScheduleSendModal
    v-model="show"
    :title="initialValue ? __('Change reminder') : __('Remind me if no reply')"
    :action="__('Remind me')"
    :past-message="__('Choose a time after the mail goes out.')"
    :failed-message="__('Could not set the reminder.')"
    :presets="() => reminderChoices(sendsAt ? dayjs(sendsAt).tz(userTimeZone()) : undefined)"
    :initial-value
    :save
  />
</template>

<script setup lang="ts">
import ScheduleSendModal from '@/apps/mail/components/Modals/ScheduleSendModal.vue'
import { userTimeZone } from '@/apps/mail/utils/datetime'
import dayjs from '@/apps/mail/utils/dayjs'
import { reminderChoices } from '@/apps/mail/utils/snoozeTimes'

const show = defineModel<boolean>()

defineProps<{
  save: (at: string) => Promise<unknown>
  // The time it is set for now, when it is being changed.
  initialValue?: string
  // When the mail goes out, if later than now: the choices count from then.
  sendsAt?: string
}>()
</script>
