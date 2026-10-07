<template>
  <!-- Variant B of the Invite strip design doc: the generic calendar glyph carries no
	     information, so it becomes the date itself — scannable down a thread at a glance — and
	     the RSVP trio becomes a segmented control, the one thing three outline buttons can't do:
	     hold a selection. -->
  <div
    v-if="invite"
    class="border-outline-gray-2 bg-surface-base mb-3 flex flex-col gap-3 rounded-4 border px-4 py-3 sm:flex-row sm:items-center"
  >
    <!-- Opening the event is the first thing anyone tries to tap, so the target is the dates and
		     the text together rather than the title alone — but it stops at the content: no flex-1,
		     or the empty space between the strip's two halves would answer to a click. Only offered
		     once the event is on a calendar of the reader's: the detail card is a view of a real
		     event, not of a parsed preview. -->
    <component
      :is="canViewEvent ? 'button' : 'div'"
      :type="canViewEvent ? 'button' : undefined"
      class="flex min-w-0 max-w-full items-center gap-3.5 self-start text-left sm:self-center"
      @click="openEventDetail"
    >
      <!-- A span gets a chip per end: one chip can only ever claim one date. The arrow between
			     them is what keeps 17 → 19 from reading as two unrelated events. -->
      <div class="flex shrink-0 items-center gap-1.5">
        <template v-for="(chip, index) in chips" :key="index">
          <ArrowRight v-if="index" class="text-ink-gray-4 size-3 shrink-0 stroke-1.5" />
          <DateChip :month="chip.month" :day="chip.day" />
        </template>
      </div>
      <div class="min-w-0 flex-1">
        <!-- The strip is the only place the event is named, so at 393px — where a real title
				     rarely fits on one line — it wraps to two rather than truncating. -->
        <span class="text-ink-gray-8 text-base-medium line-clamp-2 sm:line-clamp-1">
          {{ invite.event.title || __('Untitled event') }}
        </span>
        <span v-if="whenLabel" class="text-ink-gray-5 mt-0.5 block truncate text-sm">
          {{ whenLabel }}
        </span>
        <span v-if="locationLabel" class="text-ink-gray-5 block truncate text-sm">
          {{ locationLabel }}
        </span>
      </div>
    </component>
    <div class="flex shrink-0 items-center justify-end sm:ml-auto">
      <!-- On mobile the answers get the width the row was already spending: full-bleed, and
			     40px tall inside a 44px control, against the ~26px the intrinsic-width version gave
			     them. Same overrides the calendar app's event detail card uses, held to max-sm so
			     the desktop strip keeps its compact right-aligned control. -->
      <TabButtons
        v-if="invite.participant"
        class="max-sm:w-full max-sm:[&>div>[data-slot=tab-button]]:flex-1 max-sm:[&>div]:w-full max-sm:[&>div]:p-0.5 max-sm:[&_[data-slot=tab-button]>span]:h-10 max-sm:[&_[data-slot=tab-button]>span]:w-full"
        :options="RSVP_OPTIONS"
        :model-value="selectedResponse"
        @update:model-value="handleRsvp"
      />
      <!-- The single-button states take the same mobile treatment as the RSVP control they
			     stand in for: whichever one the strip shows, it is the row's one action and gets the
			     full width and the 40px height. -->
      <Button
        v-else-if="!invite.exists"
        class="max-sm:!h-10 max-sm:w-full"
        :label="__('Add to Calendar')"
        :loading="addInvite.isPending"
        @click="addInviteSubmit()"
      />
      <Button
        v-else
        class="max-sm:!h-10 max-sm:w-full"
        variant="outline"
        :label="__('View in Calendar')"
        @click="viewInCalendar"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button, TabButtons } from 'frappe-ui'
import { ArrowRight } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import { api, useMutation, useQuery, type OutputOf } from '@/api'
import DateChip from '@/apps/calendar/components/DateChip.vue'
import dayjs from '@/apps/calendar/utils/dayjs'
import { eventLastDay, formatEventWhen, isAllDayEvent } from '@/apps/calendar/utils/eventTime'
import { eventDayRoute, useUpcomingEvents } from '@/apps/mail/composables/useUpcomingEvents'
import type { Attachment } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'

type InviteDetails = NonNullable<OutputOf<typeof api.calendar.invites.get>>
const { attachment, account } = defineProps<{
  attachment: Attachment
  account: string
}>()
const router = useRouter()
const { isMobile } = useScreenSize()
const { selectedEvent, openEvent } = useUpcomingEvents()
const details = useQuery(api.calendar.invites.get, () => ({
  account,
  blob_id: attachment.blob_id,
}))
// A just-created calendar copy is confirmed, but the server's UID index may lag.
const confirmed = ref<{
  account: string
  blob: string
  value: InviteDetails
}>()
const currentDetails = computed(() =>
  confirmed.value?.account === account && confirmed.value.blob === attachment.blob_id
    ? confirmed.value.value
    : details.data,
)

// Only an invitation (or a plain published event) is addable — a cancellation or an attendee's
// reply also travels as text/calendar, and a banner offering to add those would be nonsense.
const invite = computed<InviteDetails | null>(() => {
  const data = currentDetails.value
  if (!data?.event) return null
  if (data.method && !['request', 'publish'].includes(data.method)) return null
  return data
})

// JSCalendar start/duration are a wall clock in the event's own zone; render them in the
// reader's, mirroring the calendar app (see @/apps/calendar/utils/datetime).
const localZone = () => dayjs.tz?.guess?.() || Intl.DateTimeFormat().resolvedOptions().timeZone
const isAllDay = computed(() => !!invite.value?.event && isAllDayEvent(invite.value.event))
const start = computed(() => {
  const event = invite.value?.event
  if (!event?.start) return null
  // An all-day event falls on the same calendar date for everyone, so it keeps its own wall
  // clock — moving its midnight into the reader's zone would slide it a day either way.
  if (isAllDay.value) return dayjs(event.start)
  if (!event.time_zone) return dayjs(event.start)
  return dayjs.tz(event.start, event.time_zone).tz(localZone())
})

// One chip for a single day, two for a span — the last day coming from the formatter rather than
// the raw end, so the exclusive midnight boundary is walked back in exactly one place.
const chips = computed(() => {
  if (!start.value) return []
  const duration = invite.value?.event.duration
  const last = eventLastDay(start.value, duration, isAllDay.value)
  return [start.value, ...(last ? [last] : [])].map((day) => ({
    month: day.format('MMM'),
    day: day.format('D'),
  }))
})
const whenLabel = computed(() =>
  start.value
    ? formatEventWhen(start.value, invite.value?.event.duration, {
        allDay: isAllDay.value,
        compact: true,
      })
    : '',
)
const locationLabel = computed(() =>
  (invite.value?.event.locations || [])
    .map((location) => location._name)
    .filter(Boolean)
    .join(', '),
)
const addInvite = useMutation(api.calendar.invites.add)
async function addInviteSubmit() {
  const input = {
    account,
    blob_id: attachment.blob_id,
  }
  const event = await addInvite.run(input)
  const before = currentDetails.value
  if (before)
    confirmed.value = {
      account: input.account,
      blob: input.blob_id,
      value: {
        ...before,
        exists: true,
        event,
      },
    }
  raiseToast(__('Event added to your calendar.'))
}

// --- RSVP (the same segmented control the calendar app's event detail card uses) ---

const RSVP_OPTIONS = [
  {
    label: __('Yes'),
    value: 'ACCEPTED',
  },
  {
    label: __('Maybe'),
    value: 'TENTATIVE',
  },
  {
    label: __('No'),
    value: 'DECLINED',
  },
]
const currentResponse = computed(() => invite.value?.participant?.status || '')
const pendingResponse = ref('')
const rsvp = useMutation(api.calendar.invites.respond)
async function respond(response: 'accepted' | 'tentative' | 'declined') {
  const input = {
    account,
    blob_id: attachment.blob_id,
    response,
  }
  const event = await rsvp.run(input)
  const before = currentDetails.value
  if (before)
    confirmed.value = {
      account: input.account,
      blob: input.blob_id,
      value: {
        ...before,
        exists: true,
        event,
        participant: before.participant
          ? {
              ...before.participant,
              status: response.toUpperCase(),
            }
          : null,
      },
    }
  raiseToast(__('Response sent.'))
  // The open card holds its own copy, so hand it the fresh one or it would keep showing the
  // previous answer.
  if (isOpen.value) openEvent(event)
}

// An RSVP is a state, so the control shows the answer as soon as it's tapped, and falls back to
// the stored one if the request fails.
const selectedResponse = computed(() =>
  rsvp.isPending ? pendingResponse.value : currentResponse.value,
)
const handleRsvp = (response?: string | number) => {
  if (typeof response !== 'string' || rsvp.isPending || response === currentResponse.value) return
  pendingResponse.value = response
  const value = response.toLowerCase()
  if (value === 'accepted' || value === 'tentative' || value === 'declined') return respond(value)
}

// Opening the event — in the card or in the calendar — needs its own id, which only a copy on
// one of the reader's calendars has; a parsed preview of an invite they haven't added yet has none.
const canViewEvent = computed(() => !!invite.value?.exists && !!invite.value.event.id)
const viewInCalendar = () => {
  const event = invite.value?.event
  if (canViewEvent.value && event) router.push(eventDayRoute(event, account))
}

// Whether the detail card is currently showing this strip's event.
const isOpen = computed(
  () => !!selectedEvent.value && selectedEvent.value.id === invite.value?.event.id,
)

// Reading an invite and leaving the thread to read the event are different things: the strip
// opens the calendar app's detail card, hosted by DefaultLayout and hung beneath this strip, so
// the message stays where it is. Mobile has no room for that card (DefaultLayout only opens it
// on desktop), so there it still hands over to the calendar app's day view.
const openEventDetail = (e: MouseEvent) => {
  const event = invite.value?.event
  if (!canViewEvent.value || !event) return
  if (isMobile.value) router.push(eventDayRoute(event, account))
  else if (isOpen.value) selectedEvent.value = null
  else if (e.currentTarget instanceof Element)
    openEvent(event, {
      anchor: {
        element: e.currentTarget,
        side: 'bottom',
      },
    })
}
</script>
