import { frappeRequest, toast } from "frappe-ui";
import type { Ref } from "vue";
import type { Router } from "vue-router";
import type { TransportManager } from "../utils/media/TransportManager";
import type { SFUClient } from "../utils/SFUClient";
import type { ChatStore } from "./useChatStore";
import type { ConnectionState } from "./useConnectionState";
import type { CurrentUser } from "./useCurrentUser";
import type { GridLayout } from "./useGridLayout";
import type { LobbyStore } from "./useLobbyStore";
import type { MediaState } from "./useMediaState";
import type { ParticipantStore } from "./useParticipantStore";
import type { RaiseHandStore } from "./useRaiseHandStore";
import type { ReactionStore } from "./useReactionStore";

interface LobbyActions {
	approveUser: (userId: string) => Promise<void>;
	approveAllUsers: () => Promise<void>;
	rejectUser: (userId: string) => Promise<void>;
}

interface MediaControlsActions {
	initializeCamera: () => Promise<void>;
	applySpeakerDevice: () => Promise<void>;
	switchInputDevice: (
		type: "camera" | "microphone" | "speaker",
		deviceId: string,
	) => Promise<void>;
}

interface ProducerLike {
	id: string;
	track: MediaStreamTrack | null;
	replaceTrack?: (opts: { track: MediaStreamTrack }) => Promise<void>;
	pause?: () => void;
	resume?: () => void;
	close?: () => void;
}

interface MediaHandlerLike {
	audioProducer: ProducerLike | null;
	videoProducer: ProducerLike | null;
	screenProducer: ProducerLike | null;
	setProducers: (producers: Record<string, unknown>) => void;
	stopScreenShare: () => void;
}

interface VideoManagerLike {
	audioElements: Map<string, HTMLAudioElement>;
}

interface SFUMeetingManagerLike {
	sfuClient: SFUClient;
	transportManager: TransportManager | null;
	mediaHandler: MediaHandlerLike | null;
	videoManager: VideoManagerLike | null;
}

export type MeetingDocLike = {
	doc: { banned_users?: Array<{ user: string }> } | null | undefined;
	setValue: { submit: (data: Record<string, unknown>) => Promise<unknown> };
	reload: () => Promise<void>;
	[key: string]: unknown;
};

interface SFUConnectionActions {
	sfuManager: Ref<SFUMeetingManagerLike | null>;
	sfuClient: SFUClient;
	joinMeetingRoom: () => Promise<void>;
	handleGuestJoinResult: (
		joinResult: Record<string, unknown>,
		guestName: string,
	) => Promise<void>;
}

interface MeetingHandlersDeps {
	connectionState: ConnectionState;
	mediaState: MediaState;
	participantStore: ParticipantStore;
	chatStore: ChatStore;
	lobbyStore: LobbyStore;
	reactionStore: ReactionStore;
	raiseHandStore: RaiseHandStore;
	gridLayout: GridLayout;
	currentUser: CurrentUser;
	sfuConnection: SFUConnectionActions;
	mediaControls: MediaControlsActions;
	lobby: LobbyActions;
	meetingDoc: MeetingDocLike;
	meetingId: string;
	isCurrentUserHost: Ref<boolean>;
	isPeopleOpen: Ref<boolean>;
	notifiedLobbyUsers: Ref<Set<string>>;
	router: Router;
}

export function useMeetingHandlers(deps: MeetingHandlersDeps) {
	const resetToPreview = () => {
		deps.connectionState.connectionError = null;
		deps.connectionState.isConnecting = false;
		deps.connectionState.isInPreview = true;
	};

	const joinMeetingFromPreview = async () => {
		await deps.sfuConnection.joinMeetingRoom();
	};

	const handleGuestJoinComplete = async ({
		guestName,
		joinResult,
	}: {
		guestName: string;
		joinResult: Record<string, unknown>;
	}) => {
		const guestId =
			(joinResult?.guest_id as string) ||
			(deps.connectionState.guestId as string);
		const resolvedGuestName = guestName || localStorage.getItem("guest_name");

		if (guestId && resolvedGuestName) {
			deps.currentUser.setCurrentUser({
				user_id: guestId,
				name: resolvedGuestName,
				full_name: resolvedGuestName,
				avatar: null,
				is_guest: true,
			});
		}

		await deps.sfuConnection.handleGuestJoinResult(
			joinResult,
			resolvedGuestName || "",
		);
	};

	const leaveWaitingRoom = () => {
		deps.lobbyStore.isWaitingForApproval = false;
		deps.lobbyStore.isJoinRequestRejected = false;
		deps.router.push({ name: "meet-home" });
	};

	const leaveLobby = async () => {
		deps.lobbyStore.isInLobby = false;
		deps.lobbyStore.isWaitingForApproval = false;
		deps.lobbyStore.lobbyParticipantCount = 0;
		deps.router.push({ name: "meet-home" });
	};

	const goHome = () => {
		deps.lobbyStore.isJoinRequestRejected = false;
		deps.lobbyStore.isInLobby = false;
		deps.router.push({ name: "meet-home" });
	};

	const tryJoinAgain = async () => {
		deps.lobbyStore.isJoinRequestRejected = false;

		const isGuestSession =
			!deps.currentUser.currentUser.value?.user_id &&
			!deps.connectionState.guestAuthToken;
		if (isGuestSession) {
			deps.connectionState.isInPreview = true;
			return;
		}

		await deps.sfuConnection.joinMeetingRoom();
	};

	const toggleChat = () => {
		deps.chatStore.isChatOpen = !deps.chatStore.isChatOpen;
		if (deps.chatStore.isChatOpen) {
			deps.chatStore.hasUnreadMessages = false;
			deps.isPeopleOpen.value = false;
		}
	};

	const handleMuteParticipant = async (participantId: string) => {
		try {
			if (deps.sfuConnection.sfuManager.value?.sfuClient) {
				deps.sfuConnection.sfuManager.value.sfuClient.sendEvent(
					"host_control",
					{
						action: "mute_participant",
						targetParticipantId: participantId,
					},
				);
			}
		} catch (error) {
			console.error("Failed to mute participant:", error);
		}
	};

	const handleKickParticipant = async (participantId: string, ban = false) => {
		try {
			if (ban) {
				await deps.meetingDoc.setValue.submit({
					banned_users: [
						...(deps.meetingDoc.doc?.banned_users || []),
						{ user: participantId },
					],
				});
			}

			if (deps.sfuConnection.sfuManager.value?.sfuClient) {
				deps.sfuConnection.sfuManager.value.sfuClient.sendEvent(
					"host_control",
					{
						action: "kick_participant",
						targetParticipantId: participantId,
					},
				);
			}
		} catch (error) {
			console.error("Failed to kick participant:", error);
		}
	};

	const handleLowerHand = async (participantId: string) => {
		try {
			if (deps.sfuConnection.sfuManager.value?.sfuClient) {
				deps.sfuConnection.sfuManager.value.sfuClient.sendEvent(
					"host_control",
					{
						action: "lower_hand",
						targetParticipantId: participantId,
					},
				);
			}
		} catch (error) {
			console.error("Failed to lower hand:", error);
		}
	};

	const handlePromoteToCohost = async (participantId: string) => {
		try {
			const response = await frappeRequest({
				url: "suite.meet.api.meeting.promote_to_cohost",
				params: {
					meeting_id: deps.meetingId,
					user_id: participantId,
				},
			});

			if ((response as { meeting_id?: string })?.meeting_id) {
				toast.success("User promoted to co-host");
				await deps.meetingDoc.reload();
			}
		} catch (error) {
			console.error("Failed to promote participant:", error);
			toast.error("Failed to promote user to co-host");
		}
	};

	const handleApproveLobbyUser = async (participantId: string) => {
		try {
			await deps.lobby.approveUser(participantId);
			deps.notifiedLobbyUsers.value.add(participantId);
		} catch (error) {
			console.error("Failed to approve lobby user:", error);
		}
	};

	const handleApproveAllLobbyUsers = async (participantIds: string[]) => {
		try {
			await deps.lobby.approveAllUsers();
			for (const userId of participantIds) {
				deps.notifiedLobbyUsers.value.add(userId);
			}
		} catch (error) {
			console.error("Failed to approve all lobby users:", error);
		}
	};

	const handleRejectLobbyUser = async (participantId: string) => {
		try {
			await deps.lobby.rejectUser(participantId);
			deps.notifiedLobbyUsers.value.add(participantId);
		} catch (error) {
			console.error("Failed to reject lobby user:", error);
		}
	};

	const handleNotificationClick = () => {
		if (!deps.chatStore.isChatOpen) {
			toggleChat();
		}
	};

	const toggleFullscreen = async () => {
		try {
			if (!document.fullscreenElement) {
				document.body?.requestFullscreen?.();
			} else {
				document.exitFullscreen?.();
			}
		} catch (error) {
			console.error("Failed to toggle fullscreen:", error);
		}
	};

	const handleReportProblem = async () => {
		const { openProblemReportEmail } = await import(
			"../utils/diagnostics/problemReport"
		);
		await openProblemReportEmail({
			meetingId: deps.meetingId,
			networkQuality: deps.connectionState.networkQuality,
			localStream: deps.mediaState.localStream,
			transportManager:
				deps.sfuConnection.sfuManager.value?.transportManager || null,
			sfuClient: deps.sfuConnection.sfuClient,
			recoveryTimeline: deps.connectionState.recoveryTimeline,
		});
	};

	const handleDeviceChanged = async (event: Record<string, unknown>) => {
		if (typeof event.type !== "string" || typeof event.deviceId !== "string") {
			return;
		}

		try {
			await deps.mediaControls.switchInputDevice(
				event.type as "camera" | "microphone" | "speaker",
				event.deviceId,
			);
		} catch (error) {
			console.error("Failed to update media with new device:", error);
		}
	};

	return {
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
	};
}
