<template>
  <!-- A phone's search by date, picked on a month the sheet's width. Between two days: the first
       day tapped, then the last, both in, and one day tapped alone is a range of that day. Before
       or after a day: one tap, the day itself out. Above the month, what is picked as the chip will
       say it, its open end said as what to tap next.

       Drawn here rather than borrowed: frappe-ui's range calendar is the desktop popover's, 28px
       cells with no size of their own, and it sat small in the middle of the sheet. The layout is
       Calendar's phone month (MiniMonth): fluid columns in a 16px gutter, the month named on the
       left of the first column, 40px arrows on the last. -->
  <BottomSheet v-model:open="open">
    <div class="px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <!-- Which side of the day, in the search screen's own chips: no title over them, as they say
           what the sheet is for. -->
      <div class="flex justify-center gap-1.5 pt-1" role="radiogroup" :aria-label="__('Dates')">
        <Button
          v-for="option in modes"
          :key="option.value"
          v-bind="searchChip(mode === option.value)"
          role="radio"
          :aria-checked="mode === option.value"
          :label="option.label"
          @click="mode = option.value"
        />
      </div>
      <p class="text-ink-gray-8 py-4 text-center text-xl font-semibold">
        <template v-if="mode === 'between'">
          <span :class="!from && 'text-ink-gray-4'">{{ from ? day(from) : __('Start') }}</span>
          <span class="text-ink-gray-4"> – </span>
          <span :class="!to && 'text-ink-gray-4'">{{ to ? day(to) : __('End') }}</span>
        </template>
        <template v-else>
          {{ mode === 'before' ? __('Before') : __('After') }}
          <span :class="!single && 'text-ink-gray-4'">{{
            single ? day(single) : __('a day')
          }}</span>
        </template>
      </p>

      <div class="flex items-center gap-1.5 pb-2 pl-[calc(100%/14-0.5rem)]">
        <span class="text-ink-gray-8 text-lg font-medium">{{ viewed.format('MMMM') }}</span>
        <span class="text-ink-gray-5 text-lg">{{ viewed.format('YYYY') }}</span>
        <span class="flex-1" />
        <Button
          variant="ghost"
          icon="lucide-chevron-left"
          class="!size-10 !rounded-full"
          :aria-label="__('Previous month')"
          @click="viewed = viewed.subtract(1, 'month')"
        />
        <Button
          variant="ghost"
          icon="lucide-chevron-right"
          class="!size-10 !rounded-full"
          :aria-label="__('Next month')"
          :disabled="!viewed.isBefore(today, 'month')"
          @click="viewed = viewed.add(1, 'month')"
        />
      </div>

      <div class="grid grid-cols-7">
        <span
          v-for="(letter, index) in weekdays"
          :key="index"
          class="text-ink-gray-5 pb-1 text-center text-sm"
        >
          {{ letter }}
        </span>
        <!-- Each day a 44px row of the grid. Between the ends a band runs behind the days, from
             the first day's centre to the last's, rounded off where a week begins or ends. -->
        <div v-for="cell in cells" :key="cell.key" class="relative flex h-11 justify-center">
          <template v-if="cell.date">
            <span
              v-if="cell.band"
              class="bg-surface-gray-3 absolute inset-y-0.5"
              :class="[
                cell.band === 'start' ? 'left-1/2 right-0' : 'left-0',
                cell.band === 'end' ? 'right-1/2' : 'right-0',
                cell.band !== 'start' && cell.weekStart && 'rounded-l-full',
                cell.band !== 'end' && cell.weekEnd && 'rounded-r-full',
              ]"
            />
            <button
              type="button"
              class="relative my-0.5 flex size-10 items-center justify-center rounded-full text-lg"
              :class="{
                'text-ink-base bg-surface-gray-10 font-semibold': cell.end,
                'text-ink-gray-8 active:bg-surface-gray-4': !cell.end && !cell.later,
                'text-ink-gray-3': cell.later,
                'font-semibold': cell.today,
              }"
              :disabled="cell.later"
              :aria-label="cell.date.format('D MMMM YYYY')"
              :aria-pressed="cell.end"
              @click="pick(cell.key)"
            >
              {{ cell.date.date() }}
            </button>
          </template>
        </div>
      </div>

      <Button
        variant="solid"
        size="lg"
        class="mt-4 w-full !rounded-full"
        :label="__('Apply')"
        :disabled="mode === 'between' ? !from : !single"
        @click="apply"
      />
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { BottomSheet, Button } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import dayjs from '@/apps/mail/utils/dayjs'
import {
  dateRangeQuery,
  heldDates,
  searchChip,
  singleDayQuery,
} from '@/apps/mail/utils/phoneSearch'
import { translate as __ } from '@/platform/translation'

const { after, before } = defineProps<{ after?: string; before?: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ pick: [range: { after?: string; before?: string }] }>()

const DAY = 'YYYY-MM-DD'
// Mail has not come from tomorrow.
const today = dayjs()
const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

type Mode = 'before' | 'between' | 'after'
const modes: { label: string; value: Mode }[] = [
  { label: __('Before'), value: 'before' },
  { label: __('Between'), value: 'between' },
  { label: __('After'), value: 'after' },
]
const mode = ref<Mode>('between')
// Between: its first and last days. Before or after: the one day.
const from = ref('')
const to = ref('')
const single = ref('')
const viewed = ref(today.startOf('month'))
// Opened on the dates the search holds, so they are changed rather than picked again, and on the
// month they end in.
watch(open, (isOpen) => {
  if (!isOpen) return
  const held = heldDates({ after, before })
  mode.value = held.mode
  from.value = held.from
  to.value = held.to
  single.value = held.single
  viewed.value = dayjs(held.to || held.single || today).startOf('month')
})

const day = (date: string) =>
  dayjs(date).format(dayjs(date).year() === today.year() ? 'D MMM' : 'D MMM YYYY')

// A first tap starts the range; the next ends it, or starts it again earlier if it is before the
// first. A tap once both ends are set starts a new range.
const pick = (key: string) => {
  if (mode.value !== 'between') single.value = key
  else if (!from.value || to.value) {
    from.value = key
    to.value = ''
  } else if (key < from.value) from.value = key
  else to.value = key
}

// The month's weeks, the days of other months left blank. Keys are YYYY-MM-DD, so they compare
// as the days do.
const cells = computed(() => {
  const first = viewed.value
  const blanks = Array.from({ length: first.day() }, (_, index) => ({
    key: `blank-${index}`,
    date: undefined,
    end: false,
    band: undefined,
    weekStart: false,
    weekEnd: false,
    today: false,
    later: false,
  }))
  const days = Array.from({ length: first.daysInMonth() }, (_, index) => {
    const date = first.date(index + 1)
    const key = date.format(DAY)
    const between = mode.value === 'between'
    const isEnd = between ? key === from.value || key === to.value : key === single.value
    const inBand =
      between && !!to.value && from.value !== to.value && key >= from.value && key <= to.value
    const weekStart = date.day() === 0 || index === 0
    const weekEnd = date.day() === 6 || index === first.daysInMonth() - 1
    // An end on a week's edge has nothing on that row to join, and draws no band.
    const lone = (key === from.value && weekEnd) || (key === to.value && weekStart)
    return {
      key,
      date,
      end: isEnd,
      band:
        !inBand || lone
          ? undefined
          : key === from.value
            ? 'start'
            : key === to.value
              ? 'end'
              : 'mid',
      weekStart,
      weekEnd,
      today: date.isSame(today, 'day'),
      // Nothing has come after today, and so nothing after it either.
      later: date.isAfter(today, 'day') || (mode.value === 'after' && date.isSame(today, 'day')),
    }
  })
  return [...blanks, ...days]
})

const apply = () => {
  emit(
    'pick',
    mode.value === 'between'
      ? dateRangeQuery(from.value, to.value || from.value)
      : singleDayQuery(mode.value, single.value),
  )
  open.value = false
}
</script>
