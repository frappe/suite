<template>
  <!-- A time of the reader's own, where none of a TimeMenu's choices will do. -->
  <form class="space-y-3" @submit.prevent="submit">
    <!-- A phone's own picker there, as the calendar's phone form uses: the desktop one's calendar
         opens behind a sheet. -->
    <FormControl
      v-model="local"
      :type="isMobile ? 'datetime-local' : 'datetime'"
      :label="__('Date and time')"
      :min="minLocal"
    />
    <ErrorMessage :message="error" />
    <Button type="submit" variant="solid" class="w-full" :label="action" />
  </form>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, ref } from 'vue'

import { useScreenSize } from '@/apps/mail/utils/composables'
import { fromLocalInput, inUserTimeZone, userTimeZone } from '@/apps/mail/utils/datetime'
import dayjs from '@/apps/mail/utils/dayjs'

const { action, pastMessage, initialValue } = defineProps<{
  action: string
  pastMessage: string
  // UTC `...Z`: the time already set, when it is being changed.
  initialValue?: string
}>()

const emit = defineEmits<{ pick: [value: string] }>()

const { isMobile } = useScreenSize()

// Both speak local wall-clock strings, the DateTimePicker (FormControl type="datetime") as
// 'YYYY-MM-DD HH:mm:ss' and the native input as 'YYYY-MM-DDTHH:mm'; fromLocalInput turns either back
// into UTC Z.
const localFormat = isMobile.value ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD HH:mm:ss'

const local = ref(initialValue ? inUserTimeZone(initialValue).format(localFormat) : '')
const error = ref('')
const minLocal = computed(() => dayjs().tz(userTimeZone()).format(localFormat))

const submit = () => {
  if (!local.value) return (error.value = __('Please pick a date and time.'))
  const value = fromLocalInput(local.value)
  if (dayjs.utc(value).isBefore(dayjs.utc())) return (error.value = pastMessage)
  emit('pick', value)
}
</script>
