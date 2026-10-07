<script setup lang="ts">
import { useNow } from '@vueuse/core'
import { Button } from 'frappe-ui'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { api, useQuery } from '@/api'
import { UpcomingEventList, type UpcomingEventRow } from '@/apps/calendar'
import { userStore as useCalendarUserStore } from '@/apps/calendar/stores/user'
import dayjs from '@/apps/calendar/utils/dayjs'
import { meetingCodeFrom } from '@/apps/meet/utils/meetingCode'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

const initializing = ref(true)
const accountError = ref(false)

interface CalendarEventParticipant {
  email: string
  _name?: string | null
  user_image?: string | null
}

interface CalendarEventLink {
  href?: string | null
}

interface CalendarEvent {
  id: string
  title?: string
  start: string
  duration?: string
  show_without_time?: boolean | 0 | 1
  participants?: CalendarEventParticipant[]
  links?: CalendarEventLink[]
  description?: string | null
}

const isOptionalString = (value: unknown) =>
  value === undefined || value === null || typeof value === 'string'

const isCalendarEventParticipant = (value: unknown): value is CalendarEventParticipant =>
  typeof value === 'object' &&
  value !== null &&
  'email' in value &&
  typeof value.email === 'string' &&
  (!('_name' in value) || isOptionalString(value._name)) &&
  (!('user_image' in value) || isOptionalString(value.user_image))

const isCalendarEventLink = (value: unknown): value is CalendarEventLink =>
  typeof value === 'object' &&
  value !== null &&
  (!('href' in value) || isOptionalString(value.href))

const isCalendarEvent = (value: unknown): value is CalendarEvent =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  typeof value.id === 'string' &&
  'start' in value &&
  typeof value.start === 'string' &&
  (!('title' in value) || isOptionalString(value.title)) &&
  (!('duration' in value) || isOptionalString(value.duration)) &&
  (!('show_without_time' in value) ||
    value.show_without_time === undefined ||
    typeof value.show_without_time === 'boolean' ||
    value.show_without_time === 0 ||
    value.show_without_time === 1) &&
  (!('description' in value) || isOptionalString(value.description)) &&
  (!('participants' in value) ||
    value.participants === undefined ||
    (Array.isArray(value.participants) && value.participants.every(isCalendarEventParticipant))) &&
  (!('links' in value) ||
    value.links === undefined ||
    (Array.isArray(value.links) && value.links.every(isCalendarEventLink)))

const router = useRouter()
const calendarStore = useCalendarUserStore()
const now = useNow({ interval: 30_000 })

const timezone = () => dayjs.tz?.guess?.() || Intl.DateTimeFormat().resolvedOptions().timeZone
const session = useSession()
// Follow the clock so a tab left open across midnight fetches the new day.
const today = computed(() => dayjs(now.value).startOf('day'))
const fromDate = computed(() => today.value.format('YYYY-MM-DD[T]HH:mm:ss'))
const toDate = computed(() => today.value.endOf('day').format('YYYY-MM-DD[T]HH:mm:ss'))
const timeZone = timezone()

const upcomingEvents = useQuery(api.calendar.events.window, () =>
  calendarStore.accountId
    ? {
        account: calendarStore.accountId,
        from_date: fromDate.value,
        to_date: toDate.value,
        time_zone: timeZone,
      }
    : false,
)

const meetings = computed(() => {
  const currentTime = dayjs(now.value)
  const data: unknown = upcomingEvents.data
  const events = Array.isArray(data) ? data.filter(isCalendarEvent) : []
  return events
    .filter((event) => {
      const start = dayjs(event.start)
      const end = start.add(dayjs.duration(event.duration || 'PT0S'))
      return getMeetingUrl(event) && end.isAfter(currentTime) && start.isSame(currentTime, 'day')
    })
    .sort((left, right) => dayjs(left.start).valueOf() - dayjs(right.start).valueOf())
    .slice(0, 4)
})

const formatMeetingMonth = (event: CalendarEvent) => dayjs(event.start).format('MMM')
const formatMeetingDay = (event: CalendarEvent) => dayjs(event.start).format('D')
const eventParticipants = (event: CalendarEvent) => {
  const participants = new Map<string, { email: string; name: string; image?: string }>()
  for (const participant of event.participants || []) {
    if (!participant.email || participants.has(participant.email)) continue
    participants.set(participant.email, {
      email: participant.email,
      name: participant._name || participant.email,
      image: participant.user_image || undefined,
    })
  }
  return [...participants.values()]
}

const isAllDayEvent = (event: CalendarEvent) => {
  const start = dayjs(event.start)
  const duration = dayjs.duration(event.duration || 'PT0S')
  return (
    event.show_without_time ||
    (start.hour() === 0 &&
      start.minute() === 0 &&
      start.second() === 0 &&
      duration.asDays() >= 1 &&
      duration.asDays() % 1 === 0)
  )
}

const formatMeetingTime = (event: CalendarEvent) => {
  if (isAllDayEvent(event)) return __('All day')

  const start = dayjs(event.start)
  const end = start.add(dayjs.duration(event.duration || 'PT0S'))
  return `${start.format('h:mm a')} – ${end.format('h:mm a')}`
}

const getMeetingUrl = (event: CalendarEvent) => {
  const link = event.links?.find((item) => getTrustedMeetUrl(item.href))
  if (link?.href) return getTrustedMeetUrl(link.href)
  const match = event.description?.match(
    /https?:\/\/\S+\/meet\/[a-zA-Z0-9-]+|\/meet\/[a-zA-Z0-9-]+/,
  )
  return getTrustedMeetUrl(match?.[0])
}

const getTrustedMeetUrl = (url?: string | null) => {
  if (!url) return ''
  const value = url.replace(/\W+$/, '')

  try {
    const parsed = new URL(value, window.location.origin)
    if (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      !parsed.username &&
      !parsed.password &&
      meetingCodeFrom(parsed.href, parsed.origin)
    )
      return parsed.origin === window.location.origin
        ? parsed.pathname + parsed.search + parsed.hash
        : parsed.href
  } catch {
    return ''
  }

  return ''
}

const getMeetingId = (event: CalendarEvent) =>
  meetingCodeFrom(getMeetingUrl(event), window.location.origin)

const joinMeeting = (event: CalendarEvent) => {
  if (getMeetingUrl(event).startsWith('http')) return
  const meetingId = getMeetingId(event)
  if (!meetingId) return
  router.push({ name: 'meet-meeting', params: { meetingId } })
}

const meetingRows = computed(() =>
  meetings.value.map((event) => ({
    id: event.id,
    title: event.title || __('Scheduled meeting'),
    month: formatMeetingMonth(event),
    day: formatMeetingDay(event),
    time: formatMeetingTime(event),
    actionLabel: __('Join {0}', [event.title || __('Scheduled meeting')]),
    href: getMeetingUrl(event).startsWith('http') ? getMeetingUrl(event) : undefined,
    participants: eventParticipants(event),
  })),
)
const joinRow = (row: UpcomingEventRow) => {
  const event = meetings.value.find((event) => event.id === row.id)
  if (event) joinMeeting(event)
}

const reload = async () => {
  initializing.value = true
  try {
    await calendarStore.loadUser()
    accountError.value = false
    if (calendarStore.accountId) await upcomingEvents.refetch()
  } catch (error) {
    accountError.value = true
    console.warn('Could not load upcoming calendar meetings:', error)
  } finally {
    initializing.value = false
  }
}

onMounted(reload)

defineExpose({ reload })
</script>

<template>
  <section
    v-if="
      meetings.length ||
      initializing ||
      upcomingEvents.isFetching ||
      accountError ||
      upcomingEvents.error
    "
    :aria-label="__('Scheduled meetings')"
  >
    <h2 class="mb-3 text-base font-medium text-ink-gray-8">{{ __('Upcoming meetings') }}</h2>
    <div
      v-if="(initializing || upcomingEvents.isFetching) && upcomingEvents.data == null"
      class="py-8 text-center text-base text-ink-gray-5"
      role="status"
    >
      {{ __('Loading meetings…') }}
    </div>
    <div
      v-else-if="accountError || upcomingEvents.error"
      class="rounded-5 border border-dashed border-outline-gray-2 px-4 py-8 text-center text-base text-ink-gray-5"
      role="alert"
    >
      {{ __('Could not load meetings.') }}
      <Button variant="outline" :label="__('Retry')" @click="reload" />
    </div>
    <UpcomingEventList
      v-else
      :events="meetingRows"
      :current-user="session.user.value?.id"
      @select="joinRow"
    />
  </section>
</template>
