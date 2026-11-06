<template>
  <!-- Under the subject: the reminder is about the conversation, not one message in it. -->
  <div
    class="bg-surface-gray-1 text-ink-gray-8 text-p-sm flex items-center gap-2 rounded-md px-3 py-1.5 max-sm:mx-3.5 max-sm:mb-2"
  >
    <span class="lucide-bell text-ink-gray-5 size-4 shrink-0" aria-hidden="true" />
    <span class="min-w-0 flex-1">
      {{
        __('Reminder on {0} if nobody replies', [formatDateTime(remindAt, 'ddd, MMM D, h:mm A')])
      }}
    </span>
    <Button variant="ghost" size="sm" :label="__('Change')" @click="emit('change')" />
    <Button variant="ghost" size="sm" :label="__('Cancel')" @click="emit('cancel')" />
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'

import { formatDateTime } from '@/apps/mail/utils/datetime'

defineProps<{ remindAt: string }>()
const emit = defineEmits<{ change: []; cancel: [] }>()
</script>
