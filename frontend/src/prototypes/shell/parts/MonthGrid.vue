<!--
  PROTOTYPE — remove. Bare 7-column month grid: weekday letters plus one cell
  per day. It renders no styling of its own — the caller styles each day through
  the `day` slot, so the sidebar mini-month and the Year view share the date
  maths without sharing a look.

  Weeks start on Sunday, matching frappe-ui's Calendar month grid.
-->
<template>
  <div>
    <div class="grid grid-cols-7 text-center text-2xs text-ink-gray-4">
      <span v-for="(letter, i) in WEEKDAY_LETTERS" :key="i" class="py-0.5">
        {{ letter }}
      </span>
    </div>
    <div class="grid grid-cols-7">
      <template v-for="day in days" :key="day.date">
        <slot name="day" v-bind="day" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'

const props = defineProps<{
  /** Any date inside the month to render. */
  month: string
}>()

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const days = computed(() => {
  const first = dayjs(props.month).startOf('month')
  // Pad back to the Sunday on or before the 1st, then run whole weeks so the
  // grid never ends mid-row.
  const start = first.subtract(first.day(), 'day')
  const last = first.endOf('month')
  const end = last.add(6 - last.day(), 'day')
  const total = end.diff(start, 'day') + 1

  return Array.from({ length: total }, (_, i) => {
    const date = start.add(i, 'day')
    return {
      date: date.format('YYYY-MM-DD'),
      label: date.date(),
      // Every grid repeats the same 31 numbers, so the bare digit is useless to
      // a screen reader. The caller puts this on the day's accessible name.
      title: date.format('dddd, D MMMM YYYY'),
      inMonth: date.month() === first.month(),
      isToday: date.isSame(dayjs(), 'day'),
    }
  })
})
</script>
