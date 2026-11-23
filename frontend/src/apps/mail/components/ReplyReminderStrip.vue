<template>
  <ThreadStrip icon="lucide-bell">
    {{ __('Reminder on {0} if nobody replies', [formatDateTime(remindAt, 'ddd, MMM D, h:mm A')]) }}
    <template #actions>
      <ReminderMenu :current="remindAt" @pick="(at: string) => emit('change', at)">
        <Button variant="ghost" size="sm" :label="__('Change')" />
      </ReminderMenu>
      <Button variant="ghost" size="sm" :label="__('Remove')" @click="emit('cancel')" />
    </template>
  </ThreadStrip>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'

import ReminderMenu from '@/apps/mail/components/ReminderMenu.vue'
import ThreadStrip from '@/apps/mail/components/ThreadStrip.vue'
import { formatDateTime } from '@/apps/mail/utils/datetime'

defineProps<{ remindAt: string }>()
const emit = defineEmits<{ change: [at: string]; cancel: [] }>()
</script>
