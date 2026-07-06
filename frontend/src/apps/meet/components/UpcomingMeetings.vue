<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Button, createResource } from 'frappe-ui'

import { userStore as useCalendarUserStore } from '@/apps/calendar/stores/user'
import dayjs from '@/apps/calendar/utils/dayjs'
import AvatarGroup from '@/apps/meet/components/AvatarGroup.vue'

const router = useRouter()
const calendarStore = useCalendarUserStore()

const timezone = () => dayjs.tz?.guess?.() || Intl.DateTimeFormat().resolvedOptions().timeZone

const upcomingEvents = createResource({
	url: 'suite.calendar.api.get_calendar_events',
	cache: 'UpcomingMeetings',
	makeParams: () => ({
		account: calendarStore.accountId,
		from_date: dayjs().startOf('day').format('YYYY-MM-DD[T]HH:mm:ss'),
		to_date: dayjs().add(2, 'day').endOf('day').format('YYYY-MM-DD[T]HH:mm:ss'),
		time_zone: timezone(),
	}),
})

const meetings = computed(() => {
	return [...(upcomingEvents.data || [])]
		.filter((event: any) => getMeetingUrl(event))
		.sort((left: any, right: any) => dayjs(left.start).valueOf() - dayjs(right.start).valueOf())
		.slice(0, 4)
})

const formatMeetingMonth = (event: any) => dayjs(event.start).format('MMM')
const formatMeetingDay = (event: any) => dayjs(event.start).format('D')

const formatMeetingTime = (event: any) => {
	const start = dayjs(event.start)
	const end = start.add(dayjs.duration(event.duration || 'PT0S'))
	return `${start.format('h:mma')} - ${end.format('h:mma')}`
}

const eventParticipants = (event: any) => {
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

const isJoinable = (event: any) => {
	const start = dayjs(event.start)
	const end = start.add(dayjs.duration(event.duration || 'PT0S'))
	const now = dayjs()
	return start.diff(now, 'minute') <= 10 && end.isAfter(now)
}

const getMeetingUrl = (event: any) => {
	const link = event.links?.find((item: any) => getTrustedMeetUrl(item?.href))
	if (link?.href) return getTrustedMeetUrl(link.href)
	const match = event.description?.match(/https?:\/\/\S+\/meet\/[a-zA-Z0-9-]+|\/meet\/[a-zA-Z0-9-]+/)
	return getTrustedMeetUrl(match?.[0])
}

const getTrustedMeetUrl = (url?: string) => {
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

const getMeetingId = (event: any) =>
	getMeetingUrl(event).split('/meet/').pop()?.replace(/\W+$/, '') || ''

const joinMeeting = (event: any) => {
	const meetingId = getMeetingId(event)
	if (!meetingId) return
	router.push({ name: 'meet-meeting', params: { meetingId } })
}

const reload = () => {
	if (calendarStore.accountId) upcomingEvents.reload()
}

onMounted(() => {
	calendarStore.userResource.promise
		.then(reload)
		.catch((error: any) => console.warn('Could not load upcoming calendar meetings:', error))
})

defineExpose({ reload })
</script>

<template>
	<div class="mt-10">
		<h2 class="mb-3 text-base-medium text-ink-gray-8">Upcoming meetings</h2>
		<div
			v-if="meetings.length"
			class="overflow-hidden rounded-xl border border-outline-gray-1 bg-surface-gray-1"
		>
			<div
				v-for="(event, index) in meetings"
				:key="event.id"
				class="flex min-h-[66px] items-center gap-8 border-outline-gray-1 px-2.5 py-2.5"
				:class="index !== meetings.length - 1 ? 'border-b' : ''"
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
								stack-direction="left"
							/>
						</div>
					</div>
				</div>

				<Button v-if="isJoinable(event)" variant="outline" @click="joinMeeting(event)">
					Join
				</Button>
			</div>
		</div>
		<p v-else class="rounded-xl border border-outline-gray-1 bg-surface-gray-1 px-4 py-5 text-sm text-ink-gray-6">
			No upcoming Meet meetings
		</p>
	</div>
</template>
