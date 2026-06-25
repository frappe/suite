<template>
	<div class="flex h-screen bg-surface-base" data-testid="home-page">
		<MeetSidebar />

		<div class="flex flex-1 flex-col overflow-auto">
			<div class="flex flex-1 items-start justify-center pt-[100px]">
				<div class="w-[600px] max-w-full px-6">
					<div class="mb-2 flex flex-col gap-0.5">
						<h1 class="text-xl-semibold text-ink-gray-8 tracking-[0.2px]">
							Hey {{ firstName }},
						</h1>
						<p class="text-sm text-ink-gray-6 tracking-[0.28px] leading-[1.5]">
							Start an instant meeting, schedule for later, or create a
							shareable meeting link.
						</p>
					</div>

					<div class="mt-[42px] flex gap-4">
						<QuickActionCard
							label="Instant meet"
							class="flex-1"
							@click="startInstantMeeting"
						>
							<template #icon>
								<LucideZap class="size-6 text-ink-gray-8" />
							</template>
						</QuickActionCard>

						<QuickActionCard
							label="Schedule a meet"
							class="flex-1"
							@click="showComingSoon"
						>
							<template #icon>
								<LucideCalendar class="size-6 text-ink-gray-8" />
							</template>
						</QuickActionCard>

						<QuickActionCard
							label="Join with code"
							class="flex-1"
							@click="showJoinDialog = true"
						>
							<template #icon>
								<LucideLink class="size-6 text-ink-gray-8" />
							</template>
						</QuickActionCard>
					</div>

					<div class="mt-[56px] flex items-center justify-between">
						<h2
							class="text-base-semibold text-ink-gray-7 tracking-[0.24px]"
						>
							Upcoming meetings
						</h2>
						<button
							class="text-sm text-ink-gray-7 hover:text-ink-gray-8 transition-colors"
							@click="showComingSoon"
						>
							See all
						</button>
					</div>

					<div class="mt-[20px] flex flex-col">
						<template v-if="meetings.loading">
							<div
								v-for="i in 3"
								:key="i"
							class="flex items-center gap-2.5 border border-outline-gray-1 px-2.5 py-2.5 first:rounded-t-xl last:rounded-b-xl bg-surface-gray-1"
						>
							<div class="h-[38px] w-11 shrink-0 rounded-lg bg-surface-gray-3 animate-pulse" />
							<div class="flex-1 space-y-2">
								<div class="h-4 w-48 rounded bg-surface-gray-3 animate-pulse" />
								<div class="h-3 w-32 rounded bg-surface-gray-3 animate-pulse" />
								</div>
							</div>
						</template>

						<template v-else-if="meetings.data && meetings.data.length > 0">
							<UpcomingMeetingItem
								v-for="(meeting, i) in meetings.data"
								:key="meeting.id"
								:meeting-id="meeting.id"
								:title="meeting.title"
								:date="meeting.date"
								:time="meeting.creation"
								:members="meeting.members"
								:member-count="meeting.member_count"
								:is-selected="selectedMeetingId === meeting.id"
								@click="selectedMeetingId = meeting.id"
								@join="joinMeeting"
							/>
						</template>

						<template v-else>
							<div
								class="flex flex-col items-center justify-center border border-outline-gray-1 rounded-xl bg-surface-gray-1 py-12"
							>
								<LucideCalendarX class="size-8 text-ink-gray-6 mb-3" />
								<p class="text-sm text-ink-gray-5">No upcoming meetings</p>
								<p class="text-xs text-ink-gray-6 mt-1">
									Start an instant meeting to get going
								</p>
							</div>
						</template>
					</div>
				</div>
			</div>
		</div>

		<Dialog
			v-model="showJoinDialog"
			:title="'Join with meeting code'"
			:dismissable="true"
		>
			<template #body-content>
				<FormControl
					v-model="meetingCode"
					placeholder="abcd-efgh-ijkl"
					:error="meetingCodeError"
					@keydown.enter="joinWithCode"
					data-testid="meeting-code-input"
				/>
			</template>
			<template #actions>
				<Button
					variant="solid"
					:disabled="!isMeetingCodeValid(meetingCode)"
					@click="joinWithCode"
					data-testid="join-meeting-button"
				>
					Join
				</Button>
			</template>
		</Dialog>
	</div>
</template>

<script setup lang="ts">
import {
	Button,
	Dialog,
	FormControl,
	createResource,
	toast,
} from "frappe-ui";
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";

import { useConnectionState } from "../composables/useConnectionState";
import MeetSidebar from "../components/MeetSidebar.vue";
import QuickActionCard from "../components/QuickActionCard.vue";
import UpcomingMeetingItem from "../components/UpcomingMeetingItem.vue";

import LucideZap from "~icons/lucide/zap";
import LucideVideo from "~icons/lucide/video";
import LucideCalendar from "~icons/lucide/calendar";
import LucideLink from "~icons/lucide/link";
import LucideCalendarX from "~icons/lucide/calendar-x";

const router = useRouter();
const connectionState = useConnectionState();
const meetingCode = ref("");
const meetingCodeError = ref("");
const showJoinDialog = ref(false);
const selectedMeetingId = ref<string | null>(null);

const userResource = createResource({
	url: "suite.api.account.get_logged_in_user",
	cache: "User",
	auto: true,
});

const firstName = computed(() => {
	const name = userResource.data?.full_name || userResource.data?.name || "";
	return name.split(" ")[0] || "there";
});

const meetings = createResource({
	url: "suite.meet.api.meeting.get_my_meetings",
	auto: true,
});

const createMeeting = createResource({
	url: "suite.meet.api.meeting.create",
	method: "POST",
	onSuccess: (meeting_code: string) => {
		router.push({
			name: "meet-meeting",
			params: { meetingId: meeting_code },
		});
		connectionState.justCreated = true;
	},
	onError: (error: any) => {
		console.error("Error creating meeting:", error);
		toast.error("Failed to create meeting. Please try again.");
	},
});

const startInstantMeeting = () => {
	toast.promise(createMeeting.submit({ meeting_type: "open" }), {
		loading: "Creating meeting...",
		success: "Meeting created successfully!",
		error: "Failed to create meeting. Please try again.",
	});
};

const showComingSoon = () => {
	toast.info("This feature is coming soon");
};

const joinMeeting = (meetingId: string) => {
	router.push({
		name: "meet-meeting",
		params: { meetingId },
	});
};

const joinWithCode = () => {
	meetingCodeError.value = "";

	if (!meetingCode.value.trim()) {
		meetingCodeError.value = "Please enter a meeting code";
		return;
	}

	if (!isMeetingCodeValid(meetingCode.value.trim())) {
		meetingCodeError.value =
			"Please enter a valid meeting code (format: xxxx-xxxx-xxxx)";
		return;
	}

	showJoinDialog.value = false;
	router.push({
		name: "meet-meeting",
		params: { meetingId: meetingCode.value.trim() },
	});
};

const isMeetingCodeValid = (code: string) => {
	const regex = /^[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}$/;
	return regex.test(code);
};

function handleQuickAction(e: Event) {
	const detail = (e as CustomEvent).detail;
	if (detail === "instant") startInstantMeeting();
}

onMounted(() => {
	window.addEventListener("meet-quick-action", handleQuickAction);
});

onUnmounted(() => {
	window.removeEventListener("meet-quick-action", handleQuickAction);
});
</script>
