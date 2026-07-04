<script setup lang="ts">
import { Button } from 'frappe-ui'

import dayjs from '@/apps/calendar/utils/dayjs'

const { meetings, currentUserEmail } = defineProps<{
	meetings: any[]
	currentUserEmail?: string
}>()

defineEmits<{
	join: [meeting: any]
}>()

const formatMeetingMonth = (event: any) => dayjs(event.start).format('MMM')
const formatMeetingDay = (event: any) => dayjs(event.start).format('D')

const formatMeetingTime = (event: any) => {
	const start = dayjs(event.start)
	const end = start.add(dayjs.duration(event.duration || 'PT0S'))
	return `${start.format('h:mma')}-${end.format('h:mm a')}`
}

const visibleParticipants = (event: any) =>
	(event.participants || []).filter((participant: any) => participant.email !== currentUserEmail)

const participantInitial = (participant: any) =>
	(participant._name || participant.email || '?').trim().charAt(0).toUpperCase()

const isJoinable = (event: any) => {
	const start = dayjs(event.start)
	const end = start.add(dayjs.duration(event.duration || 'PT0S'))
	const now = dayjs()
	return start.diff(now, 'minute') <= 10 && end.isAfter(now)
}
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
							<span v-if="visibleParticipants(event).length" class="shrink-0">・</span>
							<div
								v-if="visibleParticipants(event).length"
								class="flex isolate items-center overflow-hidden"
							>
								<div
									v-for="(participant, participantIndex) in visibleParticipants(event).slice(0, 2)"
									:key="participant.email || participantIndex"
									class="relative -mr-0.5 flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-outline-gray-1 bg-surface-gray-2 text-[9px] font-medium uppercase text-ink-gray-7"
									:style="{ zIndex: 5 - participantIndex }"
								>
									<img
										v-if="participant.user_image"
										:src="participant.user_image"
										class="size-full rounded-full object-cover"
									/>
									<span v-else>{{ participantInitial(participant) }}</span>
								</div>
								<div
									v-if="visibleParticipants(event).length > 2"
									class="relative flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-outline-gray-1 bg-surface-gray-2 text-[10px] font-medium text-ink-gray-7"
								>
									{{ visibleParticipants(event).length - 2 }}
								</div>
							</div>
						</div>
					</div>
				</div>

				<Button v-if="isJoinable(event)" variant="outline" @click="$emit('join', event)">
					Join
				</Button>
			</div>
		</div>
		<p v-else class="rounded-xl border border-outline-gray-1 bg-surface-gray-1 px-4 py-5 text-sm text-ink-gray-6">
			No upcoming Meet meetings.
		</p>
	</div>
</template>
