<template>
  <Tooltip :text="formatFullDateTime(datetime)" :disabled="format === 'list'">
    <div class="text-ink-gray-5 text-nowrap text-xs" :class="{ 'mr-1': format !== 'list' }">
      {{ formattedDate }}
    </div>
  </Tooltip>
</template>
<script setup lang="ts">
import { Tooltip } from 'frappe-ui'
import { computed } from 'vue'

import {
  formatClockTime,
  formatFullDateTime,
  formatListTime,
  formatMessageTime,
  useMinuteClock,
} from '@/apps/mail/utils/datetime'

/**
 * `thread`: a message in a conversation, dated and timed, since the sequence and the gaps between
 * replies are what a reader follows there. `clock`: the time alone, under a header that already
 * names the day. `list`: a mailbox row, scanned for recency. The hover gives the whole date, weekday
 * first, except in the list, where every row would offer it.
 */
const { datetime, format = 'thread' } = defineProps<{
  datetime: string
  format?: 'thread' | 'clock' | 'list'
}>()

// "Today" moves on at midnight in a page left open.
const now = useMinuteClock()

const formattedDate = computed(() => {
  if (format === 'clock') return formatClockTime(datetime)
  if (format === 'list') return formatListTime(datetime, now.value)
  return formatMessageTime(datetime, now.value)
})
</script>
