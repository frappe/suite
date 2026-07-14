<template>
	<div
		class="fixed inset-0 h-[100dvh] flex flex-col overflow-hidden bg-surface-base text-ink-gray-9"
		data-meeting-component
		data-theme="dark"
	>
		<div
			v-if="!hasConnectionError"
			class="shrink-0 overflow-hidden transition-[height] duration-500 ease-in-out"
			:class="headerVisible ? 'h-11' : 'h-0'"
		>
			<MeetingHeader
				:meetingId="meetingId"
				:meetingTitle="meetingTitle"
			>
				<template #right>
					<Button
						v-if="showPreview && !session.isLoggedIn"
						variant="ghost"
						size="sm"
						@click="redirectToLogin"
					>
						Sign In
					</Button>
				</template>
			</MeetingHeader>
		</div>

		<!-- Error state -->
		<div v-if="hasConnectionError" class="flex-1 flex items-center justify-center">
			<div class="text-center text-white">
				<div class="text-red-500 mb-4">
					<lucide-alert-circle class="w-12 h-12 mx-auto" />
				</div>
				<p class="text-xl mb-4">{{ connectionState.connectionError }}</p>
				<Button @click="resetToPreview" variant="outline" theme="red">Try Again</Button>
			</div>
		</div>

		<template v-else>
			<!-- Preview mode -->
			<MeetingPreview
				v-if="showPreview"
				:meetingId="meetingId"
				:isCameraOn="mediaState.isCameraOn"
				:isMicOn="mediaState.isMicOn"
				:cameraPermissionGranted="mediaState.cameraPermissionGranted"
				:microphonePermissionGranted="mediaState.microphonePermissionGranted"
				:isConnecting="connectionState.isConnecting"
				:userInitials="currentUser.userInitials.value"
				:userAvatar="currentUser.userAvatar.value"
				:currentUserName="
					currentUser.currentUser.value?.full_name ||
					currentUser.currentUser.value?.name ||
					'You'
				"
				:guestAuthToken="connectionState.guestAuthToken"
				:isWaitingForApproval="lobbyStore.isWaitingForApproval"
				:setLocalVideoRef="mediaControls.setLocalVideoRef"
				@toggle-microphone="mediaControls.toggleMicrophone()"
				@toggle-camera="mediaControls.toggleCamera()"
				@join-from-preview="joinMeetingFromPreview"
				@guest-join-complete="handleGuestJoinComplete"
				@leave-waiting-room="leaveWaitingRoom"
				@try-join-again="tryJoinAgain"
				@device-changed="handleDeviceChanged"
			/>

			<!-- Main meeting interface -->
			<template v-else>
			<div class="relative grid flex-1 min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
				<div
					v-if="recoveryMessage"
					class="absolute top-4 left-1/2 -translate-x-1/2 z-[60] max-w-[calc(100%-2rem)] rounded-full border border-blue-300/30 bg-blue-950/80 px-4 py-2 text-sm text-blue-50 shadow-lg backdrop-blur-md flex items-center gap-2"
					role="status"
					data-testid="meet-recovery-banner"
				>
					<Spinner class="h-4" />
					<span>{{ recoveryMessage }}</span>
				</div>
				<div
					v-if="e2eeJoinPendingMessage"
					class="absolute top-4 left-1/2 -translate-x-1/2 z-[60] max-w-[calc(100%-2rem)] rounded-full border border-amber-300/30 bg-amber-950/80 px-4 py-2 text-sm text-amber-50 shadow-lg backdrop-blur-md flex items-center gap-2"
					role="status"
					data-testid="e2ee-join-pending-banner"
				>
					<Spinner class="h-4" />
					<span>{{ e2eeJoinPendingMessage }}</span>
				</div>
				<div
					class="grid flex-1 min-h-0 transition-[grid-template-columns] duration-300 ease-out relative"
					:style="{
						'--panel-width': panelWidth,
						gridTemplateColumns: 'minmax(0, 1fr) var(--panel-width)',
					}"
				>
					<div class="flex flex-col min-h-0 relative">
						<!-- Video area -->
						<div class="p-2.5 flex flex-col flex-1 min-h-0 text-white">
							<MeetingLayout @open-people-panel="togglePeople" />
						</div>
					</div>

					<!-- Panel Container -->
					<Transition
						enter-active-class="transition-opacity duration-300 ease-out"
						enter-from-class="opacity-0"
						enter-to-class="opacity-100"
						leave-active-class="transition-opacity duration-300 ease-in"
						leave-from-class="opacity-100"
						leave-to-class="opacity-0"
					>
					<div
						v-if="activePanel"
						class="h-full overflow-hidden z-50 md:z-auto bg-surface-base/50 backdrop-blur-sm md:bg-transparent"
						:class="{
							'absolute inset-0 w-full': isMobile,
							relative: !isMobile,
							'md:relative': true,
						}"
						:style="{ width: isMobile ? '100%' : '24rem' }"
					>
							<!-- Chat Panel -->
							<ChatPanel
								v-if="activePanel === 'chat'"
								:open="true"
								:messages="chatStore.chatMessages"
								:user-id="(currentUser.currentUser.value?.user_id as string) || ''"
								:user-name="
									(currentUser.currentUser.value?.full_name as string) ||
									(currentUser.currentUser.value?.name as string) ||
									'You'
								"
								:isHost="isCurrentUserHost"
								:isCohost="isCurrentUserCohost"
								:isGuest="isGuestSession"
								:hostOnlyChat="chatStore.hostOnlyChat"
								@close="toggleChat"
								@send="chat.onSendChat"
							/>

							<!-- People Panel -->
							<PeoplePanel
								v-if="activePanel === 'people'"
								:open="true"
								:currentUser="currentUser.currentUser.value"
								:participants="participantsForPeoplePanel"
								:isMicOn="mediaState.isMicOn"
								:isCameraOn="mediaState.isCameraOn"
								:creatorUserId="meetingOwner"
								:coHosts="meetingCoHosts"
								:lobbyUsers="lobbyStore.lobbyUsers"
								@close="togglePeople"
								@muteParticipant="handleMuteParticipant"
								@kickParticipant="handleKickParticipant"
								@lowerHand="handleLowerHand"
								@promoteToCohost="handlePromoteToCohost"
								@approveLobbyUser="handleApproveLobbyUser"
								@approveAllLobbyUsers="handleApproveAllLobbyUsers"
								@rejectLobbyUser="handleRejectLobbyUser"
							/>
						</div>
					</Transition>
				</div>

				<!-- Meeting controls live in their own row so tiles resize without JS padding -->
				<div class="pointer-events-none min-h-0">
					<!-- Meeting controls -->
					<MeetingToolbar
						:isChatOpen="chatStore.isChatOpen"
						:isPeopleOpen="isPeopleOpen"
						:hasUnread="chatStore.hasUnreadMessages"
						:lobbyUserCount="lobbyStore.lobbyUsers?.length || 0"
						:isMicOn="mediaState.isMicOn"
						:isCameraOn="mediaState.isCameraOn"
						:isScreenSharing="mediaState.isScreenSharing"
						:isFullscreen="isFullscreen"
						:isHandRaised="isHandRaised"
						:isReactionPickerOpen="isReactionPickerOpen"
						@update:isReactionPickerOpen="isReactionPickerOpen = $event"
						:meetingId="meetingId"
						:meetingTitle="meetingTitle"
						:currentUser="currentUser.currentUser.value"
						:cameraPermissionGranted="mediaState.cameraPermissionGranted"
						:microphonePermissionGranted="mediaState.microphonePermissionGranted"
						@toggle-chat="toggleChat"
						@toggle-people="togglePeople"
						@toggle-reactions="toggleReactions($event)"
						@toggle-microphone="mediaControls.toggleMicrophone()"
						@toggle-camera="mediaControls.toggleCamera()"
						@toggle-screen-share="mediaControls.toggleScreenShare()"
						@toggle-fullscreen="toggleFullscreen"
						@toggle-raise-hand="raiseHand.toggleRaiseHand()"
						@report-problem="handleReportProblem"
						@end-call="sfuConnection.endCall()"
						@device-changed="handleDeviceChanged"
						@visibility-change="isToolbarVisible = $event"
					/>
				</div>
			</div>

			<LobbyOverlay
				v-if="(isInLobby || isWaitingForApproval) && !isRejected"
				@leave="leaveLobby"
			/>

			<RejectionOverlay v-if="isRejected && isGuestSession" @leave="goHome" />
			</template>
		</template>

		<!-- Chat notifications -->
		<ChatNotificationQueue
			ref="chatNotificationQueue"
			:auto-dismiss-delay="5000"
			@notification-click="handleNotificationClick"
		/>

		<!-- Join request notifications -->
		<JoinRequestNotifications
			:waitingUsers="lobbyUsersForNotifications"
			@approve-user="lobby.approveUser"
			@reject-user="lobby.rejectUser"
		/>
	</div>
</template>

<script setup lang="ts">
import { Button, frappeRequest, toast } from "frappe-ui";
import { computed, onMounted, onUnmounted, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import ChatNotificationQueue from "../components/ChatNotificationQueue.vue";
import ChatPanel from "../components/ChatPanel.vue";
import JoinRequestNotifications from "../components/JoinRequestNotifications.vue";
import LobbyOverlay from "../components/LobbyOverlay.vue";
import MeetingLayout from "../components/MeetingLayout.vue";
import MeetingPreview from "../components/MeetingPreview.vue";
import MeetingHeader from "../components/MeetingHeader.vue";
import MeetingToolbar from "../components/MeetingToolbar.vue";
import PeoplePanel from "../components/PeoplePanel.vue";
import RejectionOverlay from "../components/RejectionOverlay.vue";
import Spinner from "../components/Spinner.vue";
import { useBackgroundEffects } from "../composables/useBackgroundEffects";
import { useChat } from "../composables/useChat";
import { useChatStore } from "../composables/useChatStore";
import { useConnectionState } from "../composables/useConnectionState";
import { useCurrentUser } from "../composables/useCurrentUser";
import { useE2EEState } from "../composables/useE2EEState";
import { useGridLayout } from "../composables/useGridLayout";
import { useLobby } from "../composables/useLobby";
import { useLobbyStore } from "../composables/useLobbyStore";
import { useMediaControls } from "../composables/useMediaControls";
import { useMediaState } from "../composables/useMediaState";
import { provideMeetingContext } from "../composables/useMeetingContext";
import { useMeetingDoc } from "../composables/useMeetingDoc";
import {
	type MeetingDocLike,
	useMeetingHandlers,
} from "../composables/useMeetingHandlers";
import { useNoiseCancellation } from "../composables/useNoiseCancellation";
import { useParticipantStore } from "../composables/useParticipantStore";
import { useRaiseHand } from "../composables/useRaiseHand";
import { useRaiseHandStore } from "../composables/useRaiseHandStore";
import { useReactionStore } from "../composables/useReactionStore";
import { useReactions } from "../composables/useReactions";
import { useResponsiveGrid } from "../composables/useResponsiveGrid";
import {
	type SFUScreenShareData,
	useSFUConnection,
} from "../composables/useSFUConnection";
import {
	autoHideToolbar,
	selectedCameraId,
	selectedMicId,
	selectedSpeakerId,
} from "../data/mediaPreferences";
import { session, userResource } from "@/boot/session";
import { useSocket } from "../socket";
import { deviceManager } from "../utils/media/DeviceManager";
import type { Participant } from "../utils/media/ParticipantManager";
import { usePoll } from "../composables/usePoll.js";
import { usePollStore } from "../composables/usePollStore.js";

// Router
const route = useRoute();
const router = useRouter();
const meetingId = computed(() => route.params.meetingId as string);

function redirectToLogin() {
	const path = window.location.pathname.startsWith("/meet")
		? window.location.pathname
		: `/meet${window.location.pathname}`;
	window.location.href = `/login?redirect-to=${encodeURIComponent(path)}`;
}

// --- Stores (singletons) ---
const connectionState = useConnectionState();
const currentUser = useCurrentUser();
const mediaState = useMediaState();
const participantStore = useParticipantStore();
const chatStore = useChatStore();
const pollStore = usePollStore();
const lobbyStore = useLobbyStore();
const reactionStore = useReactionStore();
const raiseHandStore = useRaiseHandStore();
const gridLayout = useGridLayout(mediaState);

// --- Lobby notification tracking ---
const notifiedLobbyUsers = ref(new Set<string>());

// --- Meeting doc ---
const {
	getMeetingDoc,
	meetingTitle,
	meetingOwner,
	isCurrentUserHost,
	isCurrentUserCohost,
	meetingCoHosts,
} = useMeetingDoc();
const meetingDoc = getMeetingDoc(meetingId.value);

// --- Background effects & noise cancellation ---
const backgroundEffects = useBackgroundEffects();
const noiseCancellation = useNoiseCancellation();

// --- Lobby notification conversion ---
const lobbyUsersForNotifications = computed(() => {
	return lobbyStore.lobbyUsers
		.filter((user) => !notifiedLobbyUsers.value.has(user.userId))
		.map((user) => ({
			user_id: user.userId,
			user_name: user.name,
			user_image: user.avatar,
		}));
});

const e2eeJoinPendingMessage = ref("");
const e2eeState = useE2EEState();

function handleE2EEJoinStatus(event: Event): void {
	const detail = (event as CustomEvent).detail as
		| { status?: string; reason?: string; message?: string }
		| undefined;
	if (detail?.status === "pending") {
		e2eeJoinPendingMessage.value = getE2EEJoinPendingMessage(detail);
		return;
	}
	if (detail?.status === "failed") {
		e2eeJoinPendingMessage.value =
			detail.message ||
			"Could not set up encryption for this meeting. Please leave and try again.";
		return;
	}
	e2eeJoinPendingMessage.value = "";
}

function getE2EEJoinPendingMessage(detail: {
	reason?: string;
	message?: string;
}): string {
	if (detail.reason === "waiting-for-host") {
		return (
			detail.message ||
			"This encrypted meeting needs the host to join before others can enter."
		);
	}
	return (
		detail.message ||
		"Waiting for someone already in the encrypted meeting to let you in."
	);
}

// --- Guest session ---
const isGuestSession = computed(
	() =>
		!session.isLoggedIn &&
		(!!connectionState.guestAuthToken || lobbyStore.isWaitingForApproval),
);

// --- SFU Connection ---
const sfuConnection = useSFUConnection({
	connectionState,
	currentUser,
	mediaState,
	participantStore,
	lobbyStore,
	gridLayout,
	meetingId: meetingId.value,
	notifiedLobbyUsers,
	onHostMutedYou: () => {
		if (mediaState.isMicOn) {
			mediaControls.toggleMicrophone();
		}
	},
	onHostKickedYou: () => sfuConnection.endCall(),
	onScreenShareStarted: (data: SFUScreenShareData) => {
		const pid = data.participantId;
		if (!pid) return;
		const prev = mediaState.activeScreenShareConsumers || [];
		const filtered = prev.filter((s) => s.participantId !== pid);
		mediaState.activeScreenShareConsumers = [
			...filtered,
			{
				participantId: pid,
				consumerId: data.consumer?.id || "remote-screen",
				startedAt: data.startedAt || Date.now(),
			},
		];
		if (data.stream instanceof MediaStream) {
			try {
				const store = mediaState.screenShareStreams || {};
				store[pid] = data.stream;
				mediaState.screenShareStreams = store;
			} catch (err) {
				console.warn("Failed to store screen share stream:", err);
			}
		}
	},
	onScreenShareStopped: (data: SFUScreenShareData) => {
		const pid = data.participantId;
		const list = mediaState.activeScreenShareConsumers || [];
		mediaState.activeScreenShareConsumers = list.filter(
			(share) => share.participantId !== pid,
		);
		const store = mediaState.screenShareStreams || {};
		if (pid && store[pid]) {
			const stream = store[pid];
			const tracks = stream.getTracks();
			if (tracks) {
				for (const t of tracks) {
					t.stop();
				}
			}
			delete store[pid];
			mediaState.screenShareStreams = store;
		}
	},
	onActiveSpeakerChanged: (participantIds: string[]) => {
		participantStore.activeSpeakerIds = participantIds;
	},
});

// --- Media Controls ---
const mediaControls = useMediaControls({
	mediaState,
	connectionState,
	raiseHandStore,
	currentUser,
	sfuClient: sfuConnection.sfuClient,
	sfuManager: sfuConnection.sfuManager,
	deviceManager,
	backgroundEffects,
	noiseCancellation,
	toast,
	mediaPreferences: {
		micEnabled: ref(false),
		cameraEnabled: ref(false),
		selectedCameraId,
		selectedMicId,
		selectedSpeakerId,
		pushToTalkEnabled: ref(false),
		noiseCancellationEnabled: ref(false),
		setMicEnabled: (_v: boolean) => {
			/* handled via mediaState */
		},
		setCameraEnabled: (_v: boolean) => {
			/* handled via mediaState */
		},
		setSelectedCameraId: () => {},
		setSelectedMicId: () => {},
		setSelectedSpeakerId: () => {},
	},
});

import { meetingControls } from "../composables/useKeyboardShortcuts";

meetingControls.toggleMicrophone = () => mediaControls.toggleMicrophone();
meetingControls.toggleCamera = () => mediaControls.toggleCamera();
watch(
	() => mediaState.isMicOn,
	(val) => (meetingControls.isMicOn = val),
	{ immediate: true },
);

// --- Chat ---
const chat = useChat({
	chatStore,
	currentUser,
	sfuClient: sfuConnection.sfuClient,
});

// --- Poll ---

const poll = usePoll({
	pollStore,
	currentUser,
	sfuClient: sfuConnection.sfuClient,
});


// --- Reactions ---
const reactions = useReactions({
	reactionStore,
	currentUser,
	sfuClient: sfuConnection.sfuClient,
});

// --- Raise Hand ---
const raiseHand = useRaiseHand({
	raiseHandStore,
	currentUser,
	sfuClient: sfuConnection.sfuClient,
});

// --- Lobby ---
const lobby = useLobby({
	lobbyStore,
	meetingId: meetingId.value as string,
});

type AccessData = { allow_guest?: boolean; host_only_chat?: boolean };

// --- Provide meeting context for child components ---
provideMeetingContext({
	mediaState,
	participantStore,
	currentUser,
	chatStore,
	gridLayout,
	raiseHandStore,
	reactionStore,
	lobbyStore,
	sfuManager: sfuConnection.sfuManager.value,
	processedStream: mediaState.processedStream,
	isInMeeting: computed(() => true),
	onBackgroundEffectsChanged: mediaControls.applyBackgroundEffectsToLocalStream,
});

// Provide legacy injects for components not yet migrated to useMeetingContext
provide("setLocalVideoRef", mediaControls.setLocalVideoRef);
provide("setRemoteVideoRef", mediaControls.setRemoteVideoRef);
provide("setScreenShareVideoRef", mediaControls.setScreenShareVideoRef);
provide("getParticipantName", participantStore.getParticipantName);
provide("meetingId", meetingId.value);
provide("sfuManager", sfuConnection.sfuManager);
provide("socket", useSocket());
provide("isCurrentUserHost", isCurrentUserHost);
provide("hostControls", {
	muteParticipant: (...args: unknown[]) =>
		handleMuteParticipant(args[0] as string),
	kickParticipant: (...args: unknown[]) =>
		handleKickParticipant(args[0] as string, args[1] as boolean),
});
provide("meetingTitle", computed(() => meetingTitle.value));

provide("poll", poll);

// --- Computed properties ---
const isConnecting = computed(() => connectionState.isConnecting);
const hasConnectionError = computed(() => !!connectionState.connectionError);
const recoveryMessage = computed(() => {
	switch (connectionState.recoveryState) {
		case "reconnecting":
			return "Reconnecting to the meeting...";
		case "rejoining":
			return "Restoring your meeting session...";
		case "recovering_send":
			return "Restoring your microphone and camera...";
		case "recovering_receive":
			return "Restoring incoming media...";
		case "failed":
			return "Connection recovery failed. Try leaving and joining again.";
		default:
			return "";
	}
});
const isInLobby = computed(() => lobbyStore.isInLobby || false);
const isWaitingForApproval = computed(
	() => lobbyStore.isWaitingForApproval || false,
);
const isRejected = computed(() => lobbyStore.isJoinRequestRejected || false);
const showPreview = computed(() => {
	const isUnauthenticatedGuest = !session.isLoggedIn && !isGuestSession.value;
	if (isUnauthenticatedGuest) {
		return true;
	}

	if (isGuestSession.value) {
		return false;
	}
	if (lobbyStore.isInLobby) {
		return false;
	}
	if (lobbyStore.isWaitingForApproval) {
		return false;
	}
	const inPreview = connectionState.isInPreview;
	const joinRequestRejected = lobbyStore.isJoinRequestRejected;
	return inPreview || joinRequestRejected;
});

// Soft connecting feedback: only if join takes longer than 5s (no full-page spinner).
const CONNECTING_TOAST_ID = "meet-connecting";
const CONNECTING_TOAST_DELAY_MS = 5000;
let connectingToastTimer: ReturnType<typeof setTimeout> | null = null;

const clearConnectingToast = () => {
	if (connectingToastTimer) {
		clearTimeout(connectingToastTimer);
		connectingToastTimer = null;
	}
	toast.dismiss(CONNECTING_TOAST_ID);
};

watch(
	[
		isConnecting,
		showPreview,
		isWaitingForApproval,
		isInLobby,
		hasConnectionError,
		e2eeJoinPendingMessage,
	],
	([connecting, preview, waiting, lobby, error, e2eePending]) => {
		const shouldTrack =
			connecting &&
			!preview &&
			!waiting &&
			!lobby &&
			!error &&
			!e2eePending;

		if (!shouldTrack) {
			clearConnectingToast();
			return;
		}

		if (connectingToastTimer) {
			return;
		}

		connectingToastTimer = setTimeout(() => {
			connectingToastTimer = null;
			if (
				!connectionState.isConnecting ||
				connectionState.isInPreview ||
				lobbyStore.isWaitingForApproval ||
				lobbyStore.isInLobby ||
				connectionState.connectionError ||
				e2eeJoinPendingMessage.value
			) {
				return;
			}
			toast.loading("Connecting…", {
				id: CONNECTING_TOAST_ID,
				duration: Number.POSITIVE_INFINITY,
			});
		}, CONNECTING_TOAST_DELAY_MS);
	},
);

const isPeopleOpen = ref(false);

const activePanel = computed(() => {
	if (chatStore.isChatOpen) return "chat";
	if (isPeopleOpen.value) return "people";
	return null;
});

const participantsForPeoplePanel = computed<Record<string, Participant>>(
	() => participantStore.participants as Record<string, Participant>,
);

const { isMobile } = useResponsiveGrid();

const panelWidth = computed(() => {
	if (!activePanel.value) return "0rem";
	if (isMobile.value) return "0rem";
	return "24rem";
});

const isHandRaised = computed(() => {
	const currentUserId = currentUser.currentUser.value?.user_id as string;
	return currentUserId ? !!raiseHandStore.raisedHands?.[currentUserId] : false;
});

// --- Refs ---
const chatNotificationQueue = ref<InstanceType<
	typeof ChatNotificationQueue
> | null>(null);
const isReactionPickerOpen = ref(false);
const isFullscreen = ref(false);
const isToolbarVisible = ref(true);
const headerVisible = computed(
	() => showPreview.value || isConnecting.value || !autoHideToolbar.value || isToolbarVisible.value,
);

// --- Extracted handlers ---
const handlers = useMeetingHandlers({
	connectionState,
	mediaState,
	participantStore,
	chatStore,
	lobbyStore,
	reactionStore,
	raiseHandStore,
	gridLayout,
	currentUser,
	sfuConnection,
	mediaControls,
	lobby,
	meetingDoc: meetingDoc as unknown as MeetingDocLike,
	meetingId: meetingId.value,
	isCurrentUserHost,
	isPeopleOpen,
	notifiedLobbyUsers,
	router,
});

const {
	resetToPreview,
	joinMeetingFromPreview,
	handleGuestJoinComplete,
	leaveWaitingRoom,
	leaveLobby,
	goHome,
	tryJoinAgain,
	toggleChat,
	handleMuteParticipant,
	handleKickParticipant,
	handleLowerHand,
	handlePromoteToCohost,
	handleApproveLobbyUser,
	handleApproveAllLobbyUsers,
	handleRejectLobbyUser,
	handleNotificationClick,
	toggleFullscreen,
	handleReportProblem,
	handleDeviceChanged,
} = handlers;

// --- Local UI state ---
const togglePeople = () => {
	isPeopleOpen.value = !isPeopleOpen.value;
	if (isPeopleOpen.value) {
		chatStore.isChatOpen = false;
		if (isCurrentUserHost.value || isCurrentUserCohost.value) {
			void sfuConnection.fetchExistingWaitingRoomUsers();
		}
	}
};

const toggleReactions = (payload: string) => {
	reactions.onSendReaction(payload);
	isReactionPickerOpen.value = false;
};

const syncFullscreenState = () => {
	isFullscreen.value = !!document.fullscreenElement;
};

const setSinkIdOnVideoElements = async (sinkId: string) => {
	const videoElements = document.querySelectorAll("video");
	const promises = [];
	for (const videoEl of videoElements) {
		promises.push(
			(videoEl as HTMLVideoElement).setSinkId(sinkId).catch(() => {}),
		);
	}

	if (sfuConnection.sfuManager.value?.videoManager) {
		for (const [, audioElement] of sfuConnection.sfuManager.value.videoManager
			.audioElements) {
			promises.push(audioElement.setSinkId(sinkId).catch(() => {}));
		}
	}

	await Promise.all(promises);
};

const handleE2EENeedsMediaRepublish = async () => {
	if (!mediaState.isCameraOn && !mediaState.isMicOn) return;
	try {
		const { stream } = await mediaControls.acquireUserMedia(
			mediaState.isCameraOn,
			mediaState.isMicOn,
		);
		mediaState.localStream = stream;
		if (mediaState.isCameraOn) {
			mediaState.cameraPermissionGranted = true;
			await mediaControls.applyBackgroundEffectsToLocalStream();
		}
		if (mediaState.isMicOn) {
			mediaState.microphonePermissionGranted = true;
		}
		if (mediaState.localVideo) {
			mediaControls.setLocalVideoRef(mediaState.localVideo);
		}
		if (mediaState.localStream && sfuConnection.sfuManager.value) {
			const videoTracks = mediaState.processedStream
				? mediaState.processedStream.getVideoTracks()
				: mediaState.localStream.getVideoTracks();
			const audioTracks = mediaState.localStream.getAudioTracks();
			const streamToPublish = new MediaStream([...videoTracks, ...audioTracks]);
			await sfuConnection.sfuManager.value.publishMedia(streamToPublish, {
				publishVideo: mediaState.isCameraOn,
				publishAudio: mediaState.isMicOn,
			});
		}
	} catch (error) {
		console.error(
			"Failed to republish media after E2EE reconfiguration:",
			error,
		);
	}
};

// --- Lifecycle ---
onMounted(async () => {
	// get wasJustCreated before resetting stores else it'll be reset to false
	const wasJustCreated = connectionState.justCreated;

	// Reset all stores
	connectionState.$reset();
	mediaState.$reset();
	participantStore.$reset();
	chatStore.$reset();
	pollStore.$reset();
	lobbyStore.$reset();
	reactionStore.$reset();
	raiseHandStore.$reset();
	gridLayout.resetGridLayout();
	currentUser.resetCurrentUser();
	e2eeState.reset();

	document.addEventListener("fullscreenchange", syncFullscreenState);
	document.addEventListener(
		"meet:e2ee-needs-media-republish",
		handleE2EENeedsMediaRepublish,
	);
	document.addEventListener("meet:e2ee-join-status", handleE2EEJoinStatus);
	syncFullscreenState();

	// Check meeting access for unauthenticated users
	if (!session.isLoggedIn) {
		try {
			const accessData = await frappeRequest({
				url: "suite.meet.api.meeting.check_meeting_access",
				params: {
					meeting_id: meetingId.value,
				},
			});

			if ((accessData as AccessData).host_only_chat !== undefined) {
				chatStore.hostOnlyChat = !!(accessData as AccessData).host_only_chat;
			}
			if (!(accessData as { allow_guest?: boolean }).allow_guest) {
				const loginUrl = `/login?redirect-to=${encodeURIComponent(`/meet/${meetingId.value}`)}`;
				window.location.href = loginUrl;
				return;
			}
		} catch (error) {
			console.error("Failed to check meeting access:", error);
			return;
		}
	}

	// Setup event handlers
	chat.setupChatEvents(chatNotificationQueue.value);
	reactions.setupReactionEvents();
	raiseHand.setupRaiseHandEvents();
	poll.setupPollEvents(chatNotificationQueue.value);

	// Setup notification context watchers

	if (!session.isLoggedIn) {
		await mediaControls.initializeCamera();
		if (selectedSpeakerId.value) {
			await mediaControls.applySpeakerDevice();
		}
		connectionState.isInPreview = true;
		return;
	}

	if (!userResource.fetched) {
		try {
			await userResource.fetch();
		} catch (error) {
			console.warn("Failed to load current user profile:", error);
		}
	}

	// Initialize camera
	await mediaControls.initializeCamera();

	if (selectedSpeakerId.value) {
		await mediaControls.applySpeakerDevice();
	}

	// Auto-join if just created
	if (wasJustCreated) {
		connectionState.justCreated = false;
		await joinMeetingFromPreview();
	}
});

onUnmounted(() => {
	clearConnectingToast();
	document.removeEventListener("fullscreenchange", syncFullscreenState);
	document.removeEventListener(
		"meet:e2ee-needs-media-republish",
		handleE2EENeedsMediaRepublish,
	);
	document.removeEventListener("meet:e2ee-join-status", handleE2EEJoinStatus);
});

// Watch for localVideo element and localStream connection
watch(
	[
		() => mediaState.localVideo,
		() => mediaState.localStream,
		() => mediaState.processedStream,
	],
	async ([videoElement, stream, _processedStream]) => {
		if (videoElement && stream) {
			try {
				// Prefer processed stream (with background effects) over raw local stream
				const streamToUse = mediaState.processedStream || stream;
				const currentStreamId = streamToUse.id;
				const trackedStreamId = (videoElement as HTMLElement).dataset
					?.sourceStreamId;

				if (trackedStreamId !== currentStreamId) {
					const videoTracks = streamToUse.getVideoTracks();
					if (videoTracks.length > 0) {
						(videoElement as HTMLVideoElement).srcObject = new MediaStream(
							videoTracks,
						);
					} else {
						(videoElement as HTMLVideoElement).srcObject = streamToUse;
					}
					(videoElement as HTMLElement).dataset.sourceStreamId =
						currentStreamId;
					(videoElement as HTMLVideoElement).muted = true;
					await (videoElement as HTMLVideoElement).play();
				}

				if (
					selectedSpeakerId.value &&
					typeof (videoElement as HTMLVideoElement).setSinkId === "function"
				) {
					try {
						await (videoElement as HTMLVideoElement).setSinkId(
							selectedSpeakerId.value,
						);
					} catch (error) {
						console.warn("Could not set speaker for local video:", error);
					}
				}
			} catch (error) {
				console.warn("Could not play local video:", error);
			}
		}
	},
	{ immediate: true },
);

watch(selectedSpeakerId, async (newSpeakerId) => {
	if (
		newSpeakerId &&
		deviceManager.isDeviceAvailable(newSpeakerId, "speaker")
	) {
		await setSinkIdOnVideoElements(newSpeakerId);
	}
});

// Watch lobby users for notification tracking
watch(
	() => lobbyStore.lobbyUsers,
	(newUsers, oldUsers) => {
		if (isCurrentUserHost.value) {
			const newUserIds = new Set((newUsers || []).map((u) => u.userId));
			const oldUserIds = new Set((oldUsers || []).map((u) => u.userId));
			for (const userId of oldUserIds) {
				if (!newUserIds.has(userId)) {
					notifiedLobbyUsers.value.add(userId);
				}
			}
		}
	},
	{ immediate: true },
);

watch(
	() => chatStore.hostOnlyChat,
	(isRestricted, oldValue) => {
		if (
			isRestricted !== oldValue &&
			(isCurrentUserHost.value || isCurrentUserCohost.value) &&
			sfuConnection.sfuClient?.isConnected()
		) {
			chat.toggleRestriction(isRestricted);
		}
	},
);

let previousTheme: string | null = null;
let previousThemeMode: string | null = null;
let previousBodyTheme: string | null = null;
let previousBodyThemeMode: string | null = null;
let themeObserver: MutationObserver | null = null;
let userChangedTheme = false;

const forceDarkTheme = () => {
	if (document.documentElement.getAttribute("data-theme") !== "dark") {
		document.documentElement.setAttribute("data-theme", "dark");
	}
	if (document.body.getAttribute("data-theme") !== "dark") {
		document.body.setAttribute("data-theme", "dark");
	}
};

onMounted(() => {
	previousTheme = document.documentElement.getAttribute("data-theme");
	previousThemeMode = document.documentElement.getAttribute("data-theme-mode");
	previousBodyTheme = document.body.getAttribute("data-theme");
	previousBodyThemeMode = document.body.getAttribute("data-theme-mode");
	forceDarkTheme();
	document.documentElement.setAttribute("data-theme-mode", "dark");
	document.body.setAttribute("data-theme-mode", "dark");

	themeObserver = new MutationObserver(forceDarkTheme);
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	themeObserver.observe(document.body, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});

	const modeObserver = new MutationObserver(() => {
		userChangedTheme = true;
	});
	modeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme-mode"],
	});
});

onUnmounted(() => {
	themeObserver?.disconnect();
	themeObserver = null;

	if (userChangedTheme) {
		const mode = document.documentElement.getAttribute("data-theme-mode") || "light";
		const resolved =
			mode === "automatic"
				? window.matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light"
				: mode;
		document.documentElement.setAttribute("data-theme", resolved);
		document.documentElement.setAttribute("data-theme-mode", mode);
		document.body.setAttribute("data-theme", resolved);
		document.body.setAttribute("data-theme-mode", mode);
	} else {
		if (previousTheme) {
			document.documentElement.setAttribute("data-theme", previousTheme);
		} else {
			document.documentElement.removeAttribute("data-theme");
		}

		if (previousThemeMode) {
			document.documentElement.setAttribute("data-theme-mode", previousThemeMode);
		} else {
			document.documentElement.removeAttribute("data-theme-mode");
		}

		if (previousBodyTheme) {
			document.body.setAttribute("data-theme", previousBodyTheme);
		} else {
			document.body.removeAttribute("data-theme");
		}

		if (previousBodyThemeMode) {
			document.body.setAttribute("data-theme-mode", previousBodyThemeMode);
		} else {
			document.body.removeAttribute("data-theme-mode");
		}
	}
});
</script>
