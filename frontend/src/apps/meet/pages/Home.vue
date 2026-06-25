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
						Start an instant meeting or create a shareable meeting link.
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
						label="Join with code"
						class="flex-1"
						@click="showJoinDialog = true"
					>
						<template #icon>
							<LucideLink class="size-6 text-ink-gray-8" />
						</template>
					</QuickActionCard>
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

import LucideZap from "~icons/lucide/zap";
import LucideLink from "~icons/lucide/link";

const router = useRouter();
const connectionState = useConnectionState();
const meetingCode = ref("");
const meetingCodeError = ref("");
const showJoinDialog = ref(false);

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

const startInstantMeeting = () => {
	toast.promise(createMeeting.submit({ meeting_type: "open" }), {
		loading: "Creating meeting...",
		success: "Meeting created successfully!",
		error: "Failed to create meeting. Please try again.",
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
