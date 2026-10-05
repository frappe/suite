<script setup lang="ts">
import { useMediaQuery, useNow } from '@vueuse/core'
import { Button, useCall } from 'frappe-ui'
import { List, ListCell, ListGroup, ListRow } from 'frappe-ui/list'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

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
const isMobile = useMediaQuery('(max-width: 767px)')

const timezone = () => dayjs.tz?.guess?.() || Intl.DateTimeFormat().resolvedOptions().timeZone
const session = useSession()
const fromDate = dayjs().startOf('day').format('YYYY-MM-DD[T]HH:mm:ss')
const toDate = dayjs().add(1, 'day').endOf('day').format('YYYY-MM-DD[T]HH:mm:ss')
const timeZone = timezone()

const upcomingEvents = useCall({
  url: '/api/v2/method/suite.calendar.api.get_calendar_events',
  immediate: false,
  cacheKey:
    session.user.value?.id && calendarStore.accountId
      ? [
          'meet-calendar-events',
          window.location.origin,
          session.user.value.id,
          calendarStore.accountId,
          fromDate,
          toDate,
          timeZone,
        ]
      : undefined,
  params: () => ({
    account: calendarStore.accountId,
    from_date: fromDate,
    to_date: toDate,
    time_zone: timeZone,
  }),
})

const meetings = computed(() => {
  const currentTime = dayjs(now.value)
  const data: unknown = upcomingEvents.data
  const events = Array.isArray(data) ? data.filter(isCalendarEvent) : []
  return events
    .filter((event) => {
      const start = dayjs(event.start)
      const end = start.add(dayjs.duration(event.duration || 'PT0S'))
      return (
        getMeetingUrl(event) &&
        end.isAfter(currentTime) &&
        (start.isSame(currentTime, 'day') || start.isSame(currentTime.add(1, 'day'), 'day'))
      )
    })
    .sort((left, right) => dayjs(left.start).valueOf() - dayjs(right.start).valueOf())
})

const meetingGroups = computed(() =>
  [
    { day: 'Today', date: dayjs(now.value) },
    { day: 'Tomorrow', date: dayjs(now.value).add(1, 'day') },
  ]
    .map(({ day, date }) => ({
      day,
      events: meetings.value.filter((event) => dayjs(event.start).isSame(date, 'day')),
    }))
    .filter((group) => group.events.length),
)

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
  if (isAllDayEvent(event)) return 'All day'

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
    if (meetingCodeFrom(value, window.location.origin))
      return parsed.pathname + parsed.search + parsed.hash
  } catch {
    return ''
  }

  return ''
}

const getMeetingId = (event: CalendarEvent) =>
  meetingCodeFrom(getMeetingUrl(event), window.location.origin)

const joinMeeting = (event: CalendarEvent) => {
  const meetingId = getMeetingId(event)
  if (!meetingId) return
  router.push({ name: 'meet-meeting', params: { meetingId } })
}

const reload = async () => {
  initializing.value = true
  try {
    if (accountError.value) await calendarStore.userResource.reload()
    else await calendarStore.userResource.promise
    accountError.value = false
    if (calendarStore.accountId) await upcomingEvents.reload()
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
  <section :aria-label="__('Scheduled meetings')">
    <h2 class="pb-3 text-lg font-medium text-ink-gray-9">{{ __('Upcoming') }}</h2>
    <div
      v-if="(initializing || upcomingEvents.loading) && upcomingEvents.data == null"
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
    <div
      v-else-if="!meetings.length"
      class="rounded-5 border border-dashed border-outline-gray-2 px-4 py-8 text-center text-base text-ink-gray-5"
    >
      {{
        !calendarStore.accountId
          ? __('Set up Calendar to see scheduled meetings.')
          : __('Nothing else scheduled today or tomorrow.')
      }}
    </div>
    <List
      v-else
      class="-mx-3 list-row-px-3"
      :columns="
        isMobile ? ['11rem', 'minmax(0,1fr)', '4.5rem'] : ['11rem', 'minmax(0,1fr)', '5rem']
      "
      :row-height="isMobile ? 52 : 40"
    >
      <ListGroup v-for="group in meetingGroups" :key="group.day" :label="__(group.day)">
        <ListRow v-for="event in group.events" :key="event.id" :value="event.id">
          <ListCell>
            <span class="whitespace-nowrap text-base text-ink-gray-5">{{
              formatMeetingTime(event)
            }}</span>
          </ListCell>
          <ListCell>
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-base text-ink-gray-8">{{
                event.title || __('Scheduled meeting')
              }}</span>
              <span v-if="isMobile" class="truncate text-xs text-ink-gray-5">{{
                getMeetingId(event)
              }}</span>
            </span>
          </ListCell>
          <ListCell class="justify-end">
            <Button
              :label="__('Join')"
              variant="outline"
              :aria-label="__('Join {0}', [event.title || __('Scheduled meeting')])"
              @click="joinMeeting(event)"
            />
          </ListCell>
        </ListRow>
      </ListGroup>
    </List>
  </section>
</template>
