import { frappeRequest, toast } from "frappe-ui";
import type { Ref } from "vue";
import type { Router } from "vue-router";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import type { ChatStore } from "./useChatStore";
import {
	clearGuestSessionForExit,
	readGuestSession,
	type ConnectionState,
} from "./useConnectionState";
import type { CurrentUser } from "./useCurrentUser";
import type { GridLayout } from "./useGridLayout";
import type { LobbyStore } from "./useLobbyStore";
import type { MediaState } from "./useMediaState";
import type { DocumentResource } from "./useMeetingDoc";
import type { ParticipantStore } from "./useParticipantStore";
import type { RecoveryTimelineEntry } from "./useParticipantConnectionState";
import type { RaiseHandStore } from "./useRaiseHandStore";
import type { ReactionStore } from "./useReactionStore";
import {
	isUnknownRecord,
	type JoinPayload,
	normalizeJoinPayload,
} from "../types";

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

export type MeetingDocLike = DocumentResource;

interface SFUConnectionActions {
	sfuManager: Ref<SFUMeetingManager | null>;
	joinMeetingRoom: (options?: { switchHere?: boolean }) => Promise<void>;
	handleGuestJoinResult: (
		joinResult: JoinPayload,
		guestName: string,
	) => Promise<void>;
	recoveryTimeline: Ref<RecoveryTimelineEntry[]>;
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
	const resetToPreview = async () => {
		const manager = deps.sfuConnection.sfuManager.value;
		deps.sfuConnection.sfuManager.value = null;
		try {
			await manager?.cleanup();
		} finally {
			deps.connectionState.connectionError = null;
			deps.connectionState.isInPreview = true;
		}
	};

	const joinMeetingFromPreview = async (switchHere = false) => {
		await deps.sfuConnection.joinMeetingRoom({ switchHere });
	};

	const handleGuestJoinComplete = async ({
		guestName,
		joinResult,
	}: {
		guestName: string;
		joinResult: unknown;
	}) => {
		const normalizedJoinResult = normalizeJoinPayload(joinResult);
		if (!normalizedJoinResult) {
			deps.connectionState.connectionError = "Invalid guest join response";
			return;
		}
		const guestId =
			normalizedJoinResult.guest_id ||
			(deps.connectionState.guestId as string);
		const resolvedGuestName =
			guestName || readGuestSession(deps.meetingId)?.guestName;

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
			normalizedJoinResult,
			resolvedGuestName || "",
		);
	};

	const leaveWaitingRoom = () => {
		clearGuestSessionForExit(deps.meetingId);
		deps.lobbyStore.isWaitingForApproval = false;
		deps.lobbyStore.isJoinRequestRejected = false;
		deps.router.push({ name: "meet-home" });
	};

	const leaveLobby = async () => {
		clearGuestSessionForExit(deps.meetingId);
		deps.lobbyStore.isInLobby = false;
		deps.lobbyStore.isWaitingForApproval = false;
		deps.lobbyStore.lobbyParticipantCount = 0;
		deps.router.push({ name: "meet-home" });
	};

	const goHome = () => {
		clearGuestSessionForExit(deps.meetingId);
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
			await deps.sfuConnection.sfuManager.value?.sendHostControl(
				"mute_participant",
				participantId,
			);
		} catch (error) {
			console.error("Failed to mute participant:", error);
		}
	};

	const handleKickParticipant = async (participantId: string, ban = false) => {
		let backendBanRecorded = false;
		try {
			const shouldBan = ban && participantId.startsWith("guest_");
			const manager = deps.sfuConnection.sfuManager.value;
			if (!manager) {
				toast.error("Cannot remove this participant while disconnected. Reconnect and try again.");
				return;
			}
			if (shouldBan) {
				await frappeRequest({
					url: "suite.meet.api.meeting.ban_guest",
					params: {
						meeting_id: deps.meetingId,
						guest_id: participantId,
					},
				});
				backendBanRecorded = true;
			}

			await manager.sendHostControl(
				shouldBan ? "ban_participant" : "kick_participant",
				participantId,
			);
		} catch (error) {
			console.error("Failed to kick participant:", error);
			toast.error(
				backendBanRecorded
					? "Guest was banned but could not be disconnected. Use Remove to retry the live removal."
					: "Could not remove this participant. Please try again.",
			);
		}
	};

	const handleLowerHand = async (participantId: string) => {
		try {
			await deps.sfuConnection.sfuManager.value?.sendHostControl(
				"lower_hand",
				participantId,
			);
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

			if (
				isUnknownRecord(response) &&
				typeof response.meeting_id === "string"
			) {
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
			diagnostics:
				(await deps.sfuConnection.sfuManager.value?.getConnectionDiagnostics()) ??
				null,
			recoveryTimeline: deps.sfuConnection.recoveryTimeline.value,
		});
	};

	const handleDeviceChanged = async (event: unknown) => {
		if (
			!isUnknownRecord(event) ||
			(event.type !== "camera" &&
				event.type !== "microphone" &&
				event.type !== "speaker") ||
			typeof event.deviceId !== "string"
		) {
			return;
		}

		try {
			await deps.mediaControls.switchInputDevice(
				event.type,
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
		toggleFullscreen,
		handleReportProblem,
		handleDeviceChanged,
	};
}
