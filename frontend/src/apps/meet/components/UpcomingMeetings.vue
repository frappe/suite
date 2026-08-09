<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useNow } from '@vueuse/core'
import { createResource } from 'frappe-ui'

import { userStore as useCalendarUserStore } from '@/apps/calendar/stores/user'
import dayjs from '@/apps/calendar/utils/dayjs'
import AvatarGroup from '@/apps/meet/components/AvatarGroup.vue'

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

const upcomingEvents = createResource({
	url: 'suite.calendar.api.get_calendar_events',
	cache: 'UpcomingMeetings',
	makeParams: () => ({
		account: calendarStore.accountId,
		from_date: dayjs().startOf('day').format('YYYY-MM-DD[T]HH:mm:ss'),
		to_date: dayjs().endOf('day').format('YYYY-MM-DD[T]HH:mm:ss'),
		time_zone: timezone(),
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
			return getMeetingUrl(event) && start.isSame(currentTime, 'day') && end.isAfter(currentTime)
		})
		.sort((left, right) => dayjs(left.start).valueOf() - dayjs(right.start).valueOf())
		.slice(0, 4)
})

const formatMeetingMonth = (event: CalendarEvent) => dayjs(event.start).format('MMM')
const formatMeetingDay = (event: CalendarEvent) => dayjs(event.start).format('D')

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
	return `${start.format('h:mma')} - ${end.format('h:mma')}`
}

const eventParticipants = (event: CalendarEvent) => {
	const participantsByEmail = new Map<string, { user_id: string; full_name: string; avatar_url?: string }>()
	for (const participant of event.participants || []) {
		if (!participant.email || participantsByEmail.has(participant.email)) continue
		participantsByEmail.set(participant.email, {
			user_id: participant.email,
			full_name: participant._name || participant.email || '?',
			avatar_url: participant.user_image,
		})
	}
	return [...participantsByEmail.values()]
}

const getMeetingUrl = (event: CalendarEvent) => {
	const link = event.links?.find((item) => getTrustedMeetUrl(item.href))
	if (link?.href) return getTrustedMeetUrl(link.href)
	const match = event.description?.match(/https?:\/\/\S+\/meet\/[a-zA-Z0-9-]+|\/meet\/[a-zA-Z0-9-]+/)
	return getTrustedMeetUrl(match?.[0])
}

const getTrustedMeetUrl = (url?: string | null) => {
	if (!url) return ''
	const value = url.replace(/\W+$/, '')

	try {
		const parsed = new URL(value, window.location.origin)
		if (parsed.origin === window.location.origin && parsed.pathname.startsWith('/meet/'))
			return parsed.pathname + parsed.search + parsed.hash
	} catch {
		return ''
	}

	return ''
}

const getMeetingId = (event: CalendarEvent) =>
	getMeetingUrl(event).split('/meet/').pop()?.replace(/\W+$/, '') || ''

const joinMeeting = (event: CalendarEvent) => {
	const meetingId = getMeetingId(event)
	if (!meetingId) return
	router.push({ name: 'meet-meeting', params: { meetingId } })
}

const reload = () => {
	if (calendarStore.accountId) upcomingEvents.reload()
}

onMounted(() => {
	const userPromise = calendarStore.userResource.promise
	if (!userPromise) {
		reload()
		return
	}
	userPromise
		.then(reload)
		.catch((error: unknown) => console.warn('Could not load upcoming calendar meetings:', error))
})

defineExpose({ reload })
</script>

<template>
	<div v-if="meetings.length" class="mt-10">
		<h2 class="mb-3 text-base-medium text-ink-gray-8">Upcoming meetings</h2>
		<div class="overflow-hidden rounded-xl border border-outline-gray-1 bg-surface-gray-1">
			<button
				v-for="(event, index) in meetings"
				:key="event.id"
				type="button"
				class="flex min-h-[66px] w-full items-center gap-8 border-outline-gray-1 px-2.5 py-2.5 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-surface-gray-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink-gray-4"
				:class="index !== meetings.length - 1 ? 'border-b' : ''"
				@click="joinMeeting(event)"
			>
				<div class="flex min-w-0 flex-1 items-center gap-2.5">
					<div
						class="flex w-11 shrink-0 items-center justify-center rounded-lg border border-outline-gray-1 bg-surface-base p-1"
					>
						<div
							class="flex h-[38px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-center"
						>
							<div
								class="w-full text-[11px] font-medium uppercase leading-[1.15] tracking-[0.99px] text-ink-red-5"
							>
								{{ formatMeetingMonth(event) }}
							</div>
							<div
								class="w-full text-lg font-medium leading-[1.15] tracking-[0.18px] text-ink-gray-7"
							>
								{{ formatMeetingDay(event) }}
							</div>
						</div>
					</div>

					<div class="min-w-0 flex-1">
						<div
							class="truncate text-sm-medium leading-[1.15] tracking-[0.21px] text-ink-gray-8"
						>
							{{ event.title || 'Frappe Meet' }}
						</div>
						<div
							class="mt-1.5 flex min-w-0 items-center gap-0.5 text-sm leading-[1.15] tracking-[0.28px] text-ink-gray-6"
						>
							<span class="shrink-0">{{ formatMeetingTime(event) }}</span>
							<span v-if="eventParticipants(event).length" class="shrink-0">・</span>
							<AvatarGroup
								v-if="eventParticipants(event).length"
								:participants="eventParticipants(event)"
								:error="null"
								:max-displayed="2"
								size="sm"
							/>
						</div>
					</div>
				</div>

			</button>
		</div>
	</div>
</template>
