<template>
	<div
		class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-base"
	>
		<div
			class="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 p-5 text-ink-gray-8 lg:flex-row lg:items-center lg:gap-10 lg:px-6 lg:py-8"
		>
			<!-- Video preview remains bounded so the camera-off state does not dominate. -->
			<div class="flex min-w-0 flex-1 items-center justify-center lg:flex-[2]">
				<div
					class="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-xl lg:aspect-[3/2]"
				>
					<ParticipantTile
						class="h-full w-full"
						:participant="previewParticipant"
						:isLocal="true"
						:isVideoEnabled="isCameraOn"
						:isAudioEnabled="isMicOn"
						:videoRef="previewVideoRef"
						:showPinButton="false"
						:showReaction="false"
						:showRaisedHand="false"
						:showAudioState="false"
						:showNetworkState="false"
						:tileBackgroundClass="'bg-black'"
						:avatarBackgroundClass="'bg-surface-gray-3'"
					/>

					<PreviewToolbar
						:meetingId="meetingId"
						:isMicOn="isMicOn"
						:isCameraOn="isCameraOn"
						:cameraPermissionGranted="cameraPermissionGranted"
						:microphonePermissionGranted="microphonePermissionGranted"
						@toggle-microphone="$emit('toggle-microphone')"
						@toggle-camera="$emit('toggle-camera')"
						@device-changed="$emit('device-changed', $event)"
					/>
				</div>
			</div>

			<!-- Join details -->
			<div class="flex w-full items-center lg:w-[24rem] lg:shrink-0">
				<div class="flex w-full flex-col">
					<p
						v-if="props.meetingTitle"
						class="mb-3 truncate text-base-medium text-ink-gray-7"
					>
						{{ props.meetingTitle }}
					</p>

					<h2 class="mb-7 text-4xl-semibold text-ink-gray-9">
						Ready to join?
					</h2>

					<AvatarGroup
						v-if="!isGuest"
						:participants="[...participants]"
						:error="presenceError"
						:loading="!hasFetchedParticipants"
						:maxDisplayed="2"
						:showText="true"
						alignment="left"
					/>

					<form class="mt-7 space-y-3" @submit.prevent="handleJoin">
						<FormControl
							v-if="isGuest"
							ref="guestNameInputRef"
							v-model="guestName"
							type="text"
							label="Your name"
							placeholder="John Doe"
							:maxlength="50"
							autocomplete="off"
						/>

						<Button
							v-if="!presenceError"
							type="submit"
							variant="solid"
							size="lg"
							:loading="isConnecting || joinGuestAPI.loading"
							:disabled="isGuest && !guestName.trim()"
							class="w-full"
						>
							<template #prefix>
								<lucide-video class="h-5 w-5" />
							</template>
							Join Meeting
						</Button>
					</form>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { Button, createResource, FormControl, toast } from "frappe-ui";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import AvatarGroup from "../components/AvatarGroup.vue";
import ParticipantTile from "../components/ParticipantTile.vue";
import PreviewToolbar from "../components/PreviewToolbar.vue";
import { useMeetingPreviewPresence } from "../composables/useMeetingPreviewPresence";
import { session } from "@/boot/session";
import { getErrorMessage } from "../utils/error";
import { getInitials } from "../utils/text";
import type { Participant } from "../utils/media/ParticipantManager";
interface VideoElement {
	$el?:
		| HTMLElement
		| { querySelector: (sel: string) => HTMLInputElement | null };
}

const props = defineProps<{
	meetingId: string;
	meetingTitle?: string;
	isCameraOn?: boolean;
	isMicOn?: boolean;
	cameraPermissionGranted?: boolean;
	microphonePermissionGranted?: boolean;
	isConnecting?: boolean;
	userInitials?: string;
	userAvatar?: string;
	currentUserName?: string;
	guestAuthToken?: string | null;
	isWaitingForApproval?: boolean;
	setLocalVideoRef?: ((el: HTMLVideoElement | null) => void) | null;
}>();

const emit = defineEmits<{
	"toggle-microphone": [];
	"toggle-camera": [];
	"join-from-preview": [];
	"device-changed": [event: unknown];
	"guest-join-complete": [data: { guestName: string; joinResult: unknown }];
}>();

const guestName = ref("");

onMounted(() => {
	const savedGuestName = localStorage.getItem("guest_name");
	if (savedGuestName && !session.isLoggedIn) {
		guestName.value = savedGuestName;
	}
});
const guestNameInputRef = ref<VideoElement | null>(null);

const joinGuestAPI = createResource({
	url: "suite.meet.api.meeting.join_meeting_as_guest",
	makeParams: () => {
		return {
			meeting_id: props.meetingId,
			guest_name: guestName.value.trim(),
		};
	},
});

const isGuest = computed(() => !session.isLoggedIn && !props.guestAuthToken);

const previewName = computed(() => {
	if (isGuest.value && guestName.value.trim()) {
		return guestName.value.trim();
	}
	return props.currentUserName || props.userInitials || "You";
});

const previewParticipant = computed<Participant>(() => ({
	user_id: "preview-local-user",
	user_name: previewName.value,
	avatar: props.userAvatar || null,
	initials: getInitials(previewName.value),
	audio_enabled: props.isMicOn,
	video_enabled: props.isCameraOn,
}));

const previewVideoRef = (el: unknown) => {
	props.setLocalVideoRef?.(el as HTMLVideoElement | null);
};

const {
	participants,
	error: presenceError,
	hasFetchedParticipants,
} = useMeetingPreviewPresence(props.meetingId);

watch(guestNameInputRef, (inputRef) => {
	if (inputRef) {
		nextTick(() => {
			const input = inputRef.$el?.querySelector("input");
			input?.focus();
		});
	}
});

const handleJoin = async () => {
	if (presenceError.value) {
		return;
	}

	if (joinGuestAPI.loading || props.isConnecting) {
		return;
	}

	if (isGuest.value) {
		if (!guestName.value.trim()) {
			return;
		}

		try {
			const result = await joinGuestAPI.submit();

			localStorage.setItem("guest_name", guestName.value.trim());

			emit("guest-join-complete", {
				guestName: guestName.value.trim(),
				joinResult: result,
			});
		} catch (error) {
			console.error("Failed to join as guest:", error);
			const errorMessage =
				getErrorMessage(error) || "Failed to join meeting as guest.";
			toast.error(errorMessage);
		}
	} else {
		emit("join-from-preview");
	}
};
</script>
