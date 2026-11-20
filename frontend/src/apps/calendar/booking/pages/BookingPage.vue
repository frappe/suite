<template>
  <!-- A booking page as someone outside the company sees it, signed in or not (spec 003). It
       shows the page and its host, a month of days with free slots, and the slots of the day
       picked, in the booker's zone. Nothing about what the host is doing reaches it: the
       server answers free start times only. -->
  <main class="min-h-full bg-surface-base text-ink-gray-8">
    <div
      v-if="state === 'missing' || state === 'failed'"
      class="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center"
    >
      <div class="rounded-full bg-surface-gray-2 p-3 text-ink-gray-5">
        <span
          class="size-6"
          :class="state === 'missing' ? 'lucide-calendar-x' : 'lucide-wifi-off'"
          aria-hidden="true"
        />
      </div>
      <h1 class="text-lg-medium text-ink-gray-8">
        {{
          state === 'missing'
            ? __('This booking page does not exist')
            : __('Could not load this booking page')
        }}
      </h1>
      <p class="max-w-sm text-p-base text-ink-gray-5">
        {{
          state === 'missing'
            ? __('Check the link, or ask the person who sent it for a new one.')
            : __('Check your connection and try again.')
        }}
      </p>
      <Button v-if="state === 'failed'" class="mt-2" :label="__('Try again')" @click="retry" />
    </div>

    <div v-else class="mx-auto w-full max-w-5xl sm:px-5 sm:py-10">
      <div
        class="flex flex-col sm:rounded-7 sm:border sm:border-outline-gray-2 lg:flex-row lg:items-stretch"
      >
        <header
          class="space-y-4 border-b border-outline-gray-1 px-4 py-6 sm:px-6 lg:w-80 lg:shrink-0 lg:border-b-0 lg:border-r"
        >
          <template v-if="page">
            <div class="flex items-center gap-3">
              <Avatar
                v-if="host"
                size="2xl"
                :image="host.user_image ?? undefined"
                :label="host.full_name"
              />
              <span v-if="host" class="text-base text-ink-gray-6">{{ host.full_name }}</span>
            </div>
            <h1 class="text-2xl-semibold text-ink-gray-9">{{ page.title }}</h1>
            <p class="flex items-center gap-2 text-base text-ink-gray-6">
              <span class="lucide-clock size-4" aria-hidden="true" />
              {{ lengthLabel(page.length_minutes) }}
            </p>
            <p v-if="chosenLabel" class="flex items-start gap-2 text-base text-ink-gray-8">
              <span class="lucide-calendar-check mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {{ chosenLabel }}
            </p>
            <p v-if="page.description" class="whitespace-pre-line text-p-base text-ink-gray-7">
              {{ page.description }}
            </p>
          </template>
          <template v-else>
            <div class="flex items-center gap-3">
              <Skeleton class="size-12 rounded-full" />
              <Skeleton class="h-4 w-32" />
            </div>
            <Skeleton class="h-6 w-48" />
            <Skeleton class="h-4 w-20" />
          </template>
        </header>

        <section
          class="flex flex-1 flex-col gap-8 px-4 py-6 sm:px-6 md:flex-row"
          :aria-busy="loadingSlots"
        >
          <BookingMonth
            class="shrink-0 md:w-72"
            :month="viewed"
            :free="freeDays"
            :selected="selectedDay"
            :today="today"
            :can-go-back="canGoBack"
            :can-go-forward="canGoForward"
            @select="pickDay"
            @page="turn"
          />

          <div class="flex min-w-0 flex-1 flex-col gap-4">
            <Combobox
              trigger="button"
              :label="__('Time zone')"
              :model-value="zone"
              :options="zoneOptions"
              :placeholder="__('Time zone')"
              @update:model-value="pickZone"
            />

            <div v-if="loadingSlots" class="grid grid-cols-2 gap-2 md:grid-cols-1">
              <Skeleton v-for="index in 6" :key="index" class="h-10 rounded-4" />
            </div>

            <div v-else-if="!freeDays.size" class="py-6 text-center">
              <p class="text-base text-ink-gray-7">
                {{ __('No free times in {0}', [monthName]) }}
              </p>
              <Button
                v-if="canGoForward"
                class="mt-3"
                :label="__('Next month')"
                icon-right="lucide-arrow-right"
                @click="turn(1)"
              />
            </div>

            <template v-else-if="selectedDay">
              <h2 class="text-base-medium text-ink-gray-9">{{ dayHeading }}</h2>
              <div
                class="grid grid-cols-2 gap-2 md:grid-cols-1"
                role="group"
                :aria-label="__('Free times')"
              >
                <Button
                  v-for="slot in daySlots"
                  :key="slot"
                  size="md"
                  :variant="slot === selectedSlot ? 'solid' : 'outline'"
                  :aria-pressed="slot === selectedSlot"
                  :label="timeLabel(slot)"
                  @click="selectedSlot = slot"
                />
              </div>
              <!-- The booking form arrives with its own change; until then a chosen time goes
                   no further. -->
              <Button
                class="mt-2"
                size="md"
                variant="solid"
                :label="__('Continue')"
                :disabled="true"
              />
            </template>
          </div>
        </section>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { Avatar, Button, Combobox, Skeleton } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useQuery } from '@/api'
import BookingMonth from '@/apps/calendar/booking/features/BookingMonth.vue'
import {
  addMonths,
  dayKey,
  monthOf,
  monthStart,
  monthWindow,
  slotsByDay,
  type Month,
} from '@/apps/calendar/booking/internal/slotDays'
import { usePageTitle } from '@/platform/page-meta'
import { detectTimezone, normalizeTimezone } from '@/platform/time-zone'
import { translate as __ } from '@/platform/translation'
import { TransportError } from '@/platform/transport'

const props = defineProps<{ slug: string }>()

// The booker's zone starts as their browser's and is theirs to change (spec 003).
const zone = ref(detectTimezone())
const today = computed(() => dayKey(new Date(), zone.value))
const viewed = ref<Month>(monthOf(today.value))
const selectedDay = ref<string>()
const selectedSlot = ref<string>()

const pageQuery = useQuery(api.calendar.bookingPages.get, () => ({ slug: props.slug }))
const page = computed(() => pageQuery.data)
const host = computed(() => page.value?.hosts[0])

const slotsQuery = useQuery(api.calendar.bookingPages.slots, () =>
  page.value ? { slug: props.slug, ...monthWindow(viewed.value, zone.value) } : false,
)
const slots = computed(() => slotsQuery.data)
// Each month and zone is its own query, so a new one has no answer until it loads.
const loadingSlots = computed(() => !slots.value)

const byDay = computed(() => slotsByDay(slots.value?.slots ?? [], zone.value))
const freeDays = computed(() => new Set(loadingSlots.value ? [] : byDay.value.keys()))
const daySlots = computed(() => (selectedDay.value ? byDay.value.get(selectedDay.value) : []))

const canGoBack = computed(() => monthStart(viewed.value, zone.value) > monthStartOfToday())
const canGoForward = computed(() => {
  const until = slots.value?.bookable_until
  return (
    !!until && Date.parse(monthStart(addMonths(viewed.value, 1), zone.value)) < Date.parse(until)
  )
})
const monthStartOfToday = () => monthStart(monthOf(today.value), zone.value)

// A disabled page answers as a missing one, so both read the same (spec 003, "The link").
const state = computed(() => {
  const error = pageQuery.error ?? slotsQuery.error
  if (!error) return 'ready'
  return error instanceof TransportError && error.type === 'DoesNotExistError'
    ? 'missing'
    : 'failed'
})

function retry() {
  void (pageQuery.error ? pageQuery.refetch() : slotsQuery.refetch())
}

function turn(months: -1 | 1) {
  viewed.value = addMonths(viewed.value, months)
}

function pickDay(day: string) {
  if (day !== selectedDay.value) selectedSlot.value = undefined
  selectedDay.value = day
}

function pickZone(next: unknown) {
  if (typeof next !== 'string' || !next) return
  zone.value = next
  // A chosen time is the same instant in any zone; follow it to the day it falls on there.
  if (selectedSlot.value) {
    selectedDay.value = dayKey(selectedSlot.value, next)
    viewed.value = monthOf(selectedDay.value)
  }
}

// Each month's answer opens on its first free day, so its times show without a tap. A month
// with nothing free, on the first visit only, gives way to the next when that can be booked.
let opened = false
watch(freeDays, (free) => {
  if (loadingSlots.value) return
  const first = !opened
  opened = true
  if (!free.size) {
    if (first && canGoForward.value) turn(1)
    return
  }
  if (selectedDay.value && free.has(selectedDay.value)) return
  selectedSlot.value = undefined
  selectedDay.value = [...free].sort()[0]
})

const zoneOptions = computed(() => {
  const zones = new Set([zone.value, ...Intl.supportedValuesOf('timeZone').map(normalizeTimezone)])
  const now = new Date()
  return [...zones].sort().map((value) => ({
    value,
    label: value.replaceAll('_', ' '),
    description: offsetLabel(value, now),
  }))
})

function offsetLabel(timeZone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
  return parts.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? ''
}

const timeFormat = computed(
  () =>
    new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone.value,
    }),
)
const timeLabel = (slot: string) => timeFormat.value.format(new Date(slot))

const monthName = computed(() =>
  new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(viewed.value.year, viewed.value.month, 1)),
  ),
)

const dayHeading = computed(() =>
  selectedDay.value
    ? new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }).format(new Date(`${selectedDay.value}T00:00:00Z`))
    : '',
)

const chosenLabel = computed(() => {
  if (!selectedSlot.value || !page.value) return ''
  const start = new Date(selectedSlot.value)
  const end = new Date(start.getTime() + page.value.length_minutes * 60_000)
  const range = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone.value,
  })
  return range.formatRange(start, end)
})

/** `45 min`, `1 hr`, `1 hr 30 min`, as Calendar writes an event's length. */
function lengthLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return __('{0} min', [String(rest)])
  if (!rest) return __('{0} hr', [String(hours)])
  return __('{0} hr {1} min', [String(hours), String(rest)])
}

usePageTitle(() => page.value?.title ?? __('Book a time'))
</script>
