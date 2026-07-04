<template>
 	<div class="flex-1 flex flex-col bg-surface-base" data-testid="meeting-preview">
		<div class="flex-1 flex lg:flex-row flex-col text-ink-gray-8">
 			<div class="max-w-7xl mx-auto w-full flex lg:flex-row flex-col">
 				<!-- Video Section -->
 				<div class="lg:flex-[2] flex flex-col items-center justify-center p-6 lg:pr-4">
 					<div class="max-w-3xl w-full">
						<div
							class="relative bg-black rounded-xl overflow-hidden aspect-video shadow-xl group w-full"
							data-testid="preview-video-shell"
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
						</div>

					<PreviewToolbar
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
 
 				<!-- Join Section -->
 				<div
 					class="lg:flex-[1] flex items-center justify-center p-6 lg:pl-4"
 				>
 					<div class="max-w-md w-full">
 						<div class="p-8 mb-6 w-full h-full flex flex-col justify-center">
 							<div class="mb-6 text-center">
 								<div class="mb-4">
 									<div
 								class="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 bg-surface-gray-2"
 							>
 								<lucide-video class="w-8 h-8 text-ink-gray-8" />
 							</div>
 						</div>
 
 						<h2 class="text-5xl text-ink-gray-8 mb-3">
 							<span class="text-ink-gray-8"> Ready to join? </span>
 						</h2>
 
 						<div v-if="meetingTitle" class="rounded-lg px-4 py-3 mb-4">
 							<p class="text-xl-medium text-ink-gray-7 truncate">
 								{{ meetingTitle }}
 							</p>
 						</div>
 
 						<!-- Avatar group for current participants -->
						<AvatarGroup
							v-if="!isGuest"
							:participants="[...participants]"
							:error="presenceError"
							:maxDisplayed="3"
						/>
 							</div>
 
 							<form class="space-y-3" @submit.prevent="handleJoin">
 								<FormControl
 									v-if="isGuest"
 									ref="guestNameInputRef"
 									v-model="guestName"
 									type="text"
 									label="Your name"
 									placeholder="John Doe"
 									:maxlength="50"
 									autocomplete="off"
 									data-testid="guest-name-input"
 								/>
 
 								<Button
 									v-if="!presenceError"
 									type="submit"
 									variant="solid"
 									size="lg"
 									:loading="isConnecting || joinGuestAPI.loading"
 									:disabled="isGuest && !guestName.trim()"
 									class="w-full"
 									data-testid="join-meeting-preview-button"
 								>
 									<template #prefix>
 										<lucide-video class="w-5 h-5" />
 									</template>
 									Join Meeting
 								</Button>
 							</form>
 						</div>
 					</div>
 				</div>
 			</div>
 		</div>
 	</div>
 </template>

<script setup lang="ts">
import { Button, createResource, FormControl, toast } from "frappe-ui";
import { computed, inject, nextTick, onMounted, ref, watch } from "vue";
import AvatarGroup from "../components/AvatarGroup.vue";
import ParticipantTile from "../components/ParticipantTile.vue";
import PreviewToolbar from "../components/PreviewToolbar.vue";
import { useMeetingPreviewPresence } from "../composables/useMeetingPreviewPresence";
import { session } from "@/boot/session";
import { getErrorMessage } from "../utils/error";
import type { Participant } from "../utils/media/ParticipantManager";
interface VideoElement {
	$el?:
		| HTMLElement
		| { querySelector: (sel: string) => HTMLInputElement | null };
}

const props = defineProps<{
	meetingId: string;
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

const meetingTitle = inject("meetingTitle");

const isGuest = computed(() => !session.isLoggedIn && !props.guestAuthToken);

const previewParticipant = computed<Participant>(() => ({
	user_id: "preview-local-user",
	user_name: props.currentUserName || props.userInitials || "You",
	avatar: props.userAvatar || null,
	initials: props.userInitials || "",
	audio_enabled: props.isMicOn,
	video_enabled: props.isCameraOn,
}));

const previewVideoRef = (el: unknown) => {
	props.setLocalVideoRef?.(el as HTMLVideoElement | null);
};

const { participants, error: presenceError } = useMeetingPreviewPresence(
	props.meetingId,
);

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
