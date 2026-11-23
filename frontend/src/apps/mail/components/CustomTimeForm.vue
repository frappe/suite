<template>
  <!-- A time of the reader's own, where none of a TimeMenu's choices will do: a dialog's on desktop,
       a sheet's on a phone, the calendar open in it rather than behind a field. -->
  <form class="space-y-3" @submit.prevent="submit">
    <!-- The calendar's padding is taken back, so its grid's edges are the Time field's and the
         buttons'; it spreads to the form's width (below). -->
    <div class="calendar -mx-2">
      <!-- Today can land on a day the calendar isn't showing, and it only follows a date set from
           outside: started again, it opens on the date. Belongs in frappe-ui's selectToday. -->
      <DateCalendar
        :key="todayPresses"
        v-model="date"
        :min="today"
        :today-label="__('Today')"
        @today="todayPresses++"
      />
    </div>
    <TimePicker v-model="time" :label="__('Time')" />
    <!-- Its line is kept, so the message showing doesn't move the buttons. -->
    <div class="min-h-5"><ErrorMessage :message="error" /></div>
    <div class="flex gap-2">
      <Button class="flex-1" :label="__('Cancel')" @click="emit('cancel')" />
      <Button type="submit" variant="solid" class="flex-1" :label="action" :disabled="!date" />
    </div>
  </form>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, TimePicker } from 'frappe-ui'
import { DateCalendar } from 'frappe-ui/experimental'
import { ref, watch } from 'vue'

import { fromLocalInput, inUserTimeZone, userTimeZone } from '@/apps/mail/utils/datetime'
import dayjs from '@/apps/mail/utils/dayjs'

const { action, pastMessage, initialValue } = defineProps<{
  action: string
  pastMessage: string
  // UTC `...Z`: the time already set, when it is being changed.
  initialValue?: string
}>()

const emit = defineEmits<{ pick: [value: string]; cancel: [] }>()

const now = dayjs().tz(userTimeZone())
// The time already set, or else tomorrow morning, as the choices' Tomorrow.
const start = initialValue
  ? inUserTimeZone(initialValue)
  : now.add(1, 'day').hour(9).minute(0).second(0)

// Local wall-clock parts, the calendar's `YYYY-MM-DD` and the time picker's `HH:mm`.
const date = ref(start.format('YYYY-MM-DD'))
const time = ref(start.format('HH:mm'))
const today = now.format('YYYY-MM-DD')
const error = ref('')
const todayPresses = ref(0)

const chosen = () =>
  date.value && time.value ? fromLocalInput(`${date.value}T${time.value.slice(0, 5)}`) : ''
const isPast = (value: string) => !!value && dayjs.utc(value).isBefore(dayjs.utc())
// Earlier days can't be chosen, an earlier hour today can. Turning to today (its cell, or Today)
// with a time already gone moves the time on to the next full hour, so the day is the reader's
// whole choice; only a time they set themselves is told it's past.
watch(date, (day) => {
  error.value = ''
  if (day !== today || !isPast(chosen())) return
  const next = dayjs().tz(userTimeZone()).add(1, 'hour').startOf('hour')
  // Past 11 PM, that is tomorrow.
  date.value = next.format('YYYY-MM-DD')
  time.value = next.format('HH:mm')
})
watch(time, () => {
  error.value = isPast(chosen()) ? pastMessage : ''
})

const submit = () => {
  const value = chosen()
  if (!value) return (error.value = __('Please pick a date and time.'))
  if (isPast(value)) return (error.value = pastMessage)
  emit('pick', value)
}
</script>

<style scoped>
/* DateCalendar is built for a popover, at a fixed size: 28px cells, a 208px grid, a 208px square
   month and year view. Here it spreads to the form's width, and every reach into it is kept here
   until frappe-ui offers it as an option of its own. */

/* The day view: its weekday row and its weeks (flex, gap-0.5) spread their fixed cells. */
.calendar :deep([role='grid'] > :first-child),
.calendar :deep([role='row']) {
  justify-content: space-between;
}

/* The month and year view (h-52 w-52): the form's width, and the day view's height (weekdays 1.75rem
   and mb-1, six weeks of 1.75rem and five gaps of 0.125rem), so switching views doesn't move what's
   below. */
.calendar :deep(.h-52.w-52) {
  width: 100%;
  height: 13.125rem;
}

/* Its two halves (w-1/2): the second is pl-1.5 from the first, so the first gives the same on its
   side, and the selected pills come out the same width. */
.calendar :deep(.h-52.w-52 > :first-child) {
  padding-right: 0.375rem;
}
</style>
