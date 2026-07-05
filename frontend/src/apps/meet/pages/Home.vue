<template>
	<div class="flex h-screen bg-surface-base" data-testid="home-page">
		<MeetSidebar />

		<div class="flex flex-1 flex-col overflow-auto">
			<div class="flex flex-1 items-start justify-center pt-[100px]">
				<div class="w-[760px] max-w-full px-6">
					<div class="mb-2 flex flex-col gap-0.5">
						<h1 class="text-xl-semibold text-ink-gray-8 tracking-[0.2px]">
							Hey {{ firstName }},
						</h1>
						<p class="text-sm text-ink-gray-6 tracking-[0.28px] leading-[1.5]">
							Start an open meeting, create a restricted meeting, or join with a code.
						</p>
					</div>

					<div class="mt-[42px] grid grid-cols-2 gap-4 md:grid-cols-4">
						<button
							class="group flex flex-1 flex-col items-center gap-2.5 rounded-2xl border border-outline-gray-1 bg-surface-gray-1 p-1.5 transition-colors hover:bg-surface-gray-2"
							@click="startInstantMeeting"
						>
							<div class="flex h-[100px] w-full items-center justify-center rounded-[14px] border border-outline-gray-1 bg-surface-base">
								<div class="flex h-11 w-11 items-center justify-center rounded-[30px] bg-surface-base text-ink-gray-8 transition-transform group-hover:scale-105">
									<LucideZap class="size-6 text-ink-gray-8" />
								</div>
							</div>
							<span class="text-sm-medium w-full truncate text-center text-ink-gray-8 tracking-[0.21px]">Instant meet</span>
						</button>

						<button
							class="group flex flex-1 flex-col items-center gap-2.5 rounded-2xl border border-outline-gray-1 bg-surface-gray-1 p-1.5 transition-colors hover:bg-surface-gray-2"
							@click="startRestrictedMeeting"
						>
							<div class="flex h-[100px] w-full items-center justify-center rounded-[14px] border border-outline-gray-1 bg-surface-base">
								<div class="flex h-11 w-11 items-center justify-center rounded-[30px] bg-surface-base text-ink-gray-8 transition-transform group-hover:scale-105">
									<LucideLock class="size-6 text-ink-gray-8" />
								</div>
							</div>
							<span class="text-sm-medium w-full truncate text-center text-ink-gray-8 tracking-[0.21px]">Restricted meet</span>
						</button>

						<button
							class="group flex flex-1 flex-col items-center gap-2.5 rounded-2xl border border-outline-gray-1 bg-surface-gray-1 p-1.5 transition-colors hover:bg-surface-gray-2"
							@click="openScheduleDialog"
						>
							<div class="flex h-[100px] w-full items-center justify-center rounded-[14px] border border-outline-gray-1 bg-surface-base">
								<div class="flex h-11 w-11 items-center justify-center rounded-[30px] bg-surface-base text-ink-gray-8 transition-transform group-hover:scale-105">
									<LucideCalendarPlus class="size-6 text-ink-gray-8" />
								</div>
							</div>
							<span class="text-sm-medium w-full truncate text-center text-ink-gray-8 tracking-[0.21px]">Schedule meet</span>
						</button>

						<button
							class="group flex flex-1 flex-col items-center gap-2.5 rounded-2xl border border-outline-gray-1 bg-surface-gray-1 p-1.5 transition-colors hover:bg-surface-gray-2"
							@click="showJoinDialog = true"
						>
							<div class="flex h-[100px] w-full items-center justify-center rounded-[14px] border border-outline-gray-1 bg-surface-base">
								<div class="flex h-11 w-11 items-center justify-center rounded-[30px] bg-surface-base text-ink-gray-8 transition-transform group-hover:scale-105">
									<LucideLink class="size-6 text-ink-gray-8" />
								</div>
							</div>
							<span class="text-sm-medium w-full truncate text-center text-ink-gray-8 tracking-[0.21px]">Join with code</span>
						</button>
					</div>

					<UpcomingMeetings ref="upcomingMeetingsRef" />
				</div>
			</div>
		</div>

		<Dialog
			v-model="showJoinDialog"
			:title="'Join with meeting code'"
			:dismissable="true"
		>
			<template #default>
				<FormControl
					v-model="meetingCode"
					placeholder="abcd-efgh-ijkl"
					:error="meetingCodeError"
					@keydown.enter="joinWithCode"
					data-testid="meeting-code-input"
				/>
			</template>
			<template #actions>
				<div class="flex justify-end">
					<Button
						variant="solid"
						@click="joinWithCode"
						data-testid="join-meeting-button"
					>
						Join
					</Button>
				</div>
			</template>
		</Dialog>

		<Dialog v-model="showScheduleDialog" :title="'Schedule meet'" :dismissable="true">
			<template #default>
				<div class="space-y-4">
					<FormControl v-model="scheduleTitle" label="Title" placeholder="Team meeting" />
					<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
						<FormControl v-model="scheduleDate" label="Date" type="date" />
						<FormControl v-model="scheduleStartTime" label="Start" type="time" />
						<FormControl v-model="scheduleEndTime" label="End" type="time" />
					</div>
					<ParticipantSelector
						v-model="scheduleParticipants"
						:account="calendarStore.accountId"
						:display-participants="scheduledParticipants"
						:excluded-emails="currentUserEmail ? [currentUserEmail] : []"
					/>
				</div>
			</template>
			<template #actions>
				<div class="flex justify-end">
					<Button
						variant="solid"
						:loading="scheduleMeeting.loading"
						:disabled="!isScheduleTimeValid"
						@click="submitScheduledMeeting"
					>
						Schedule
					</Button>
				</div>
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

import { userStore as useCalendarUserStore } from "@/apps/calendar/stores/user";
import dayjs from "@/apps/calendar/utils/dayjs";
import ParticipantSelector from "@/apps/calendar/components/ParticipantSelector.vue";
import { useConnectionState } from "../composables/useConnectionState";
import MeetSidebar from "../components/MeetSidebar.vue";
import UpcomingMeetings from "../components/UpcomingMeetings.vue";
import LucideCalendarPlus from "~icons/lucide/calendar-plus";
import LucideZap from "~icons/lucide/zap";
import LucideLink from "~icons/lucide/link";
import LucideLock from "~icons/lucide/lock";

const router = useRouter();
const connectionState = useConnectionState();
const calendarStore = useCalendarUserStore();
const meetingCode = ref("");
const meetingCodeError = ref("");
const showJoinDialog = ref(false);
const showScheduleDialog = ref(false);
const scheduleTitle = ref("");
const scheduleDate = ref(dayjs().format("YYYY-MM-DD"));
const scheduleStartTime = ref(dayjs().add(1, "hour").startOf("hour").format("HH:mm"));
const scheduleEndTime = ref(dayjs().add(2, "hour").startOf("hour").format("HH:mm"));
const scheduleParticipants = ref<any[]>([]);
const upcomingMeetingsRef = ref<{ reload: () => void } | null>(null);

const userResource = createResource({
	url: "suite.api.account.get_logged_in_user",
	cache: "User",
	auto: true,
});

const firstName = computed(() => {
	const name = userResource.data?.full_name || userResource.data?.name || "";
	return name.split(" ")[0] || "there";
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

const scheduleStart = computed(() => dayjs(`${scheduleDate.value}T${scheduleStartTime.value}`));
const scheduleEnd = computed(() => dayjs(`${scheduleDate.value}T${scheduleEndTime.value}`));

const isScheduleTimeValid = computed(
	() =>
		Boolean(scheduleDate.value && scheduleStartTime.value && scheduleEndTime.value) &&
		scheduleStart.value.isValid() &&
		scheduleEnd.value.isValid() &&
		scheduleEnd.value.isAfter(scheduleStart.value),
);

const scheduledDuration = computed(() => {
	if (!isScheduleTimeValid.value) return "";
	const start = scheduleStart.value;
	const end = scheduleEnd.value;
	const diff = dayjs.duration(end.diff(start));
	return dayjs.duration({ hours: Math.floor(diff.asHours()), minutes: diff.minutes() }).toISOString();
});

const currentUserEmail = computed(() => calendarStore.userResource.data?.name || userResource.data?.name);

const scheduledParticipants = computed(() => {
	const currentName = calendarStore.userResource.data?.full_name || userResource.data?.full_name;
	const currentImage = calendarStore.userResource.data?.user_image || userResource.data?.user_image;
	const participants = currentUserEmail.value
		? [
				{
					email: currentUserEmail.value,
					_name: currentName,
					user_image: currentImage,
					participation_status: "ACCEPTED",
				},
			]
		: [];

	participants.push(...scheduleParticipants.value);

	return participants;
});

const scheduleMeeting = createResource({
	url: "suite.meet.api.schedule.create_scheduled_meeting",
	makeParams: () => ({
		account: calendarStore.accountId,
		title: scheduleTitle.value,
		start: scheduleStart.value.format("YYYY-MM-DD[T]HH:mm:ss"),
		duration: scheduledDuration.value,
		time_zone: dayjs.tz?.guess?.() || Intl.DateTimeFormat().resolvedOptions().timeZone,
		participants: scheduledParticipants.value,
		send_scheduling_messages: scheduledParticipants.value.length > 1,
	}),
	onSuccess: () => {
		showScheduleDialog.value = false;
		toast.success("Meeting scheduled.");
		upcomingMeetingsRef.value?.reload();
	},
	onError: (error: any) => {
		console.error("Error scheduling meeting:", error);
	},
});

const startInstantMeeting = () => {
	toast.promise(createMeeting.submit({ meeting_type: "open" }), {
		loading: "Creating meeting...",
		success: "Meeting created successfully!",
		error: "Failed to create meeting. Please try again.",
	});
};

const startRestrictedMeeting = () => {
	toast.promise(createMeeting.submit({ meeting_type: "restricted" }), {
		loading: "Creating restricted meeting...",
		success: "Restricted meeting created successfully!",
		error: "Failed to create meeting. Please try again.",
	});
};

const openScheduleDialog = async () => {
	try {
		await calendarStore.userResource.promise;
		if (!calendarStore.accountId) {
			toast.error("Set up Calendar before scheduling a Meet.");
			return;
		}
		showScheduleDialog.value = true;
	} catch (error) {
		console.error("Failed to load calendar account:", error);
		toast.error("Could not load Calendar account.");
	}
};

const submitScheduledMeeting = () => {
	if (!calendarStore.accountId) {
		toast.error("Set up Calendar before scheduling a Meet.");
		return;
	}
	if (!isScheduleTimeValid.value) {
		toast.error("Enter a valid date and an end time after the start time.");
		return;
	}
	toast.promise(scheduleMeeting.submit(), {
		loading: "Scheduling meeting...",
		error: "Failed to schedule meeting. Please try again.",
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

onMounted(() => {
	document.documentElement.style.overflow = "hidden";
});
onUnmounted(() => {
	document.documentElement.style.overflow = "";
});

</script>
