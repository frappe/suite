import { createResource, frappeRequest, toast } from "frappe-ui";
import {
	defineAsyncComponent,
	h,
	onUnmounted,
	type Ref,
	shallowRef,
} from "vue";
import { useRouter } from "vue-router";
import { useSocket } from "../socket";
import audioNotificationManager from "../utils/audioNotifications";
import { getErrorMessage } from "../utils/error";
import { waitForE2EEContextReady } from "../utils/media/E2EEContextReady";
import { SocketIOSignalChannel } from "../utils/media/SignalChannel";
import {
	type ConnectionDetails,
	connectionDetailsFromJoinPayload,
	SFUClient,
} from "../utils/SFUClient";
import { SFUMeetingManager } from "../utils/SFUMeetingManager";
import { getClientTelemetry } from "../utils/telemetry/ClientTelemetry";
import { useChatStore } from "./useChatStore";
import type { ConnectionState } from "./useConnectionState";
import type { CurrentUser } from "./useCurrentUser";
import {
	type E2EEConnectionHandshake,
	useE2EEConnectionHandshake,
} from "./useE2EEConnectionHandshake";
import type { GridLayout } from "./useGridLayout";
import type { LobbyStore } from "./useLobbyStore";
import type { MediaState } from "./useMediaState";
import type { ParticipantStore } from "./useParticipantStore";
import type { RecordingState } from "./useRecording";
import {
	isUnknownRecord,
	type JoinPayload,
	type JoinUserData,
	normalizeJoinPayload,
} from "../types";
import type {
	Participant,
	ParticipantUpdate,
} from "../utils/media/ParticipantManager";

const LARGE_MEETING_PARTICIPANT_THRESHOLD = 5;

interface WaitingRoomResponse {
	waiting_users: Array<{
		user_id: string;
		full_name?: string;
		user_image?: string;
		is_guest?: boolean;
	}>;
}

interface MeetingRealtimeEvent {
	meeting: string;
	user: string;
	userName?: string;
	userImage?: string;
}

function normalizeMeetingRealtimeEvent(value: unknown): MeetingRealtimeEvent | null {
	if (
		!isUnknownRecord(value) ||
		typeof value.meeting !== "string" ||
		typeof value.user !== "string"
	) return null;
	return {
		meeting: value.meeting,
		user: value.user,
		userName: typeof value.user_name === "string" ? value.user_name : undefined,
		userImage: typeof value.user_image === "string" ? value.user_image : undefined,
	};
}

function normalizeGuestRealtimeEvent(
	value: unknown,
): { guestId: string; meetingId: string } | null {
	if (
		!isUnknownRecord(value) ||
		typeof value.guest_id !== "string" ||
		typeof value.meeting_id !== "string"
	) return null;
	return { guestId: value.guest_id, meetingId: value.meeting_id };
}

function normalizeWaitingRoomResponse(value: unknown): WaitingRoomResponse | null {
	if (!isUnknownRecord(value) || !Array.isArray(value.waiting_users)) return null;
	const waitingUsers: WaitingRoomResponse["waiting_users"] = [];
	for (const candidate of value.waiting_users) {
		if (!isUnknownRecord(candidate) || typeof candidate.user_id !== "string") {
			continue;
		}
		waitingUsers.push({
			user_id: candidate.user_id,
			full_name:
				typeof candidate.full_name === "string" ? candidate.full_name : undefined,
			user_image:
				typeof candidate.user_image === "string" ? candidate.user_image : undefined,
			is_guest:
				typeof candidate.is_guest === "boolean" ? candidate.is_guest : undefined,
		});
	}
	return { waiting_users: waitingUsers };
}

export interface SFUScreenShareData {
	participantId?: string;
	consumer?: { id: string };
	startedAt?: number;
	stream?: MediaStream;
}

interface SFUConnectionAPI {
	sfuClient: SFUClient;
	sfuManager: Ref<SFUMeetingManager | null>;
	joinMeetingRoom: () => Promise<void>;
	handleGuestJoinResult: (
		joinResult: JoinPayload,
		guestName: string,
	) => Promise<void>;
	setupFrappeRealtimeEventListeners: () => void;
	endCall: () => Promise<void>;
	fetchExistingWaitingRoomUsers: () => Promise<void>;
	localNetworkQuality: Ref<string>;
}

export function useSFUConnection(deps: {
	connectionState: ConnectionState;
	currentUser: CurrentUser;
	mediaState: MediaState;
	participantStore: ParticipantStore;
	lobbyStore: LobbyStore;
	gridLayout: GridLayout;
	meetingId: string;
	notifiedLobbyUsers: Ref<Set<string>>;
	onHostMutedYou: () => void;
	onHostKickedYou: () => void;
	onScreenShareStarted: (data: SFUScreenShareData) => void;
	onScreenShareStopped: (data: SFUScreenShareData) => void;
	onActiveSpeakerChanged: (participantIds: string[]) => void;
	onRecordingState?: (recording: RecordingState | null) => void;
	onRecordingEnabled?: (enabled: boolean) => void;
}): SFUConnectionAPI {
	const {
		connectionState,
		currentUser,
		mediaState,
		participantStore,
		lobbyStore,
		meetingId,
		notifiedLobbyUsers,
		onHostMutedYou,
		onHostKickedYou,
		onScreenShareStarted,
		onScreenShareStopped,
		onActiveSpeakerChanged,
		onRecordingState,
		onRecordingEnabled,
	} = deps;

	const router = useRouter();
	const socket = useSocket();

	const chatStore = useChatStore();

	const signalChannel = new SocketIOSignalChannel();
	const sfuClient = new SFUClient(signalChannel);
	const clientTelemetry = getClientTelemetry(sfuClient);
	const sfuManager = shallowRef<SFUMeetingManager | null>(null);

	const realtimeListenersSetup = shallowRef(false);
	const joiningInProgress = shallowRef(false);
	const hasShownE2EEKeyMismatchToast = shallowRef(false);
	const isCurrentTabHost = shallowRef(false);
	let setupCancelled = false;

	const e2eeHandshake: E2EEConnectionHandshake = useE2EEConnectionHandshake({
		meetingId,
		sfuClient,
		sfuManager,
		currentUser,
		mediaState,
		isCurrentTabHost,
	});

	const joinMeetingAPI = createResource({
		url: "suite.meet.api.meeting.join_meeting",
		method: "POST",
		makeParams: () => ({ meeting_id: meetingId }),
	});

	const activeSpeakerTimeout = shallowRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const localNetworkQuality = shallowRef("good");
	let stabilityCheckTimeout: ReturnType<typeof setTimeout> | null = null;

	const handleParticipantJoined = (participant: Participant) => {
		const participantName = participant?.user_name || participant?.user_id;
		const participantId = participant.participantId || participant?.user_id;
		const currentUserId = currentUser.currentUser.value?.user_id;

		if (
			!participantId ||
			participantId === currentUserId ||
			participant?.user_id === currentUserId
		) {
			return;
		}

		const isRejoin = !!participantStore.participants[participantId];

		participantStore.addParticipant(participant);

		if (isRejoin || sfuManager.value?.initialSyncInProgress) {
			return;
		}

		audioNotificationManager.playJoinNotification(
			participant.user_id,
		);

		const LucideUserIcon = defineAsyncComponent(
			() => import("~icons/lucide/user"),
		);

		toast(`${participantName} joined the meeting`, {
			icon: participant.avatar
				? h("img", {
						src: participant.avatar as string,
						class: "h-5 w-5 rounded-full object-cover",
					})
				: h(LucideUserIcon),
			duration: 3000,
		});
	};

	const handleParticipantLeft = ({
		participantId,
	}: {
		participantId: string;
	}) => {
		const participant = participantStore.participants[participantId];
		const participantName = participant?.user_name || participantId;

		participantStore.removeParticipant(participantId);

		if (participantId === currentUser.currentUser.value?.user_id) {
			return;
		}

		const LucideUserIcon = defineAsyncComponent(
			() => import("~icons/lucide/user"),
		);

		toast(`${participantName} left the meeting`, {
			icon: participant?.avatar
				? h("img", {
						src: participant.avatar as string,
						class: "h-4 w-4 rounded-full object-cover",
					})
				: h(LucideUserIcon),
			duration: 3000,
		});
	};

	const handleParticipantUpdated = (
		participantId: string,
		_participant: Participant,
		updates: ParticipantUpdate,
	) => {
		if (participantId) {
			participantStore.updateParticipant(participantId, updates || {});
		}
	};

	const createSFUEventHandlers = () => {
		return {
			onRecoveryExhausted: () => {
				clientTelemetry.reportRecoveryExhausted({
					subsystem: "consumer",
					direction: "recv",
					reason: "retry_limit",
				});
			},
			onRecoveryStateChange: (
				state: Parameters<typeof connectionState.setRecoveryState>[0],
				detail?: string,
			) => {
				connectionState.setRecoveryState(state, detail);
				clientTelemetry.recordRecoveryState(state, detail);
			},
			onParticipantJoined: handleParticipantJoined,
			onParticipantLeft: handleParticipantLeft,
			onParticipantUpdated: handleParticipantUpdated,
			onNetworkQualityUpdated: (participantId: string, quality: string) => {
				if (participantId === currentUser.currentUser.value?.user_id) {
					localNetworkQuality.value = quality;
				}
			},
			onScreenShareStarted: onScreenShareStarted,
			onScreenShareStopped: onScreenShareStopped,
			onActiveSpeakerChanged: (participantIds: string[]) => {
				if (activeSpeakerTimeout.value) {
					clearTimeout(activeSpeakerTimeout.value);
					activeSpeakerTimeout.value = null;
				}
				if (stabilityCheckTimeout) {
					clearTimeout(stabilityCheckTimeout);
					stabilityCheckTimeout = null;
				}

				onActiveSpeakerChanged(participantIds);

				const STABLE_THRESHOLD_MS = 1000;
				const DEMOTE_THRESHOLD_MS = 3000;

				const checkStability = () => {
					const now = Date.now();
					const currentSet = new Set(participantStore.activeSpeakerIds);
					const startTimes = {
						...participantStore.speakerStartTimes,
					} as Record<string, number>;
					const currentStable = new Set(
						participantStore.stableSpeakerIds || [],
					);

					let hasPendingCandidates = false;

					for (const id of Object.keys(startTimes)) {
						if (!currentSet.has(id)) {
							if (startTimes[id] > 0) {
								startTimes[id] = -now;
							} else if (now - Math.abs(startTimes[id]) > DEMOTE_THRESHOLD_MS) {
								delete startTimes[id];
								currentStable.delete(id);
							}
						} else if (startTimes[id] < 0) {
							startTimes[id] = now;
						}
					}

					for (const id of currentSet) {
						if (startTimes[id] === undefined) {
							startTimes[id] = now;
						}
					}

					for (const id of currentSet) {
						const startTime = startTimes[id];
						if (startTime > 0) {
							if (now - startTime >= STABLE_THRESHOLD_MS) {
								currentStable.add(id);
							} else {
								hasPendingCandidates = true;
							}
						}
					}

					participantStore.speakerStartTimes = startTimes;
					participantStore.stableSpeakerIds = Array.from(currentStable);

					if (hasPendingCandidates) {
						if (stabilityCheckTimeout) clearTimeout(stabilityCheckTimeout);
						stabilityCheckTimeout = setTimeout(checkStability, 200);
					} else {
						stabilityCheckTimeout = null;
					}
				};

				checkStability();

				if (participantIds.length > 0) {
					activeSpeakerTimeout.value = setTimeout(() => {
						participantStore.activeSpeakerIds = [];
						activeSpeakerTimeout.value = null;
					}, 1000);
				}
			},
			onHostMutedYou: onHostMutedYou,
			onHostKickedYou: (_data: unknown) => {
				toast.error("You have been removed from the meeting by the host");
				onHostKickedYou();
			},
		};
	};

	const setupSFUConnection = async (
		guestName: string | null = null,
		initialIsHost = false,
		initialIsCohost = false,
		prefetchedDetails: ConnectionDetails | null = null,
	) => {
		setupCancelled = false;
		clientTelemetry.startSession();
		let isHost = initialIsHost;
		let isCohost = initialIsCohost;
		let manager: SFUMeetingManager | null = null;
		isCurrentTabHost.value = isHost;
		if (connectionState.isSetupComplete) {
			connectionState.isInPreview = false;
			connectionState.isConnecting = false;
			return;
		}

		try {
			let wasAutomaticallyMuted = false;
			manager = new SFUMeetingManager(sfuClient);
			manager.initialize({
				meetingId,
				currentUser: currentUser.currentUser.value,
				eventHandlers: createSFUEventHandlers(),
			});
			sfuManager.value = manager;
			const stopIfCancelled = async () => {
				if (!setupCancelled) return false;
					await manager!.cleanup();
				if (sfuManager.value === manager) {
					sfuManager.value = null;
				}
				return true;
			};

			// Register SFU signaling handlers before connect/join. E2EE joiners can
			// receive their host envelope immediately after sending their hello.
			setupFrappeRealtimeEventListeners();

			await manager.connect(
				connectionState.guestAuthToken,
				prefetchedDetails,
			);
			if (await stopIfCancelled()) return;
			connectionState.codecStrategy = sfuClient.getCodecStrategy() || "svc";
			if (!guestName) {
				const effectiveIsHost = sfuClient.connectionDetails.isHost || isHost;
				const effectiveIsCohost =
					sfuClient.connectionDetails.isCohost || isCohost;
				isHost = effectiveIsHost;
				isCohost = effectiveIsCohost;
				isCurrentTabHost.value = isHost;
			}

			if (sfuClient.isE2EERequired()) {
				if (!sfuClient.isInsertableStreamsSupported()) {
					throw new Error(
						"This meeting requires E2EE, but your browser does not support encoded insertable streams.",
					);
				}
			}

			let userData: JoinUserData;
			if (guestName) {
				userData = {
					name: guestName,
					userId: connectionState.guestId || "",
					avatar: null,
					is_guest: true,
					isHost: false,
				};
			} else {
				userData = {
					name:
						currentUser.currentUser.value?.full_name ||
						currentUser.currentUser.value?.name ||
						"You",
					userId: currentUser.currentUser.value?.user_id || "",
					avatar: currentUser.currentUser.value?.avatar || "",
					is_guest: false,
					isHost,
				};
			}

			const wantsAudio = mediaState.isMicOn;
			await manager.joinRoom(userData, {
				audio_enabled: false,
				video_enabled: mediaState.isCameraOn,
			});
			if (await stopIfCancelled()) return;

			if (wantsAudio) {
				let shouldMute = true;
				try {
					const participants = await sfuClient.getRoomParticipants();
					shouldMute =
						participants.length > LARGE_MEETING_PARTICIPANT_THRESHOLD;
				} catch (error) {
					console.warn(
						"Could not determine meeting size; joining muted:",
						(error as Error).message,
					);
				}

				if (shouldMute) {
					mediaState.isMicOn = false;
					wasAutomaticallyMuted = true;
					for (const track of mediaState.localStream?.getAudioTracks() || []) {
						track.enabled = false;
					}
				} else {
					sfuClient.sendMediaControl("unmute");
				}
			}
			if (sfuClient.isE2EERequired()) {
				await waitForE2EEContextReady(0);
				if (await stopIfCancelled()) return;
			}

			await manager.initializeDevice();
			if (await stopIfCancelled()) return;
			await manager.createReceiveTransport();
			if (await stopIfCancelled()) return;

			// Send path (local publish) and recv path (existing remotes) are
			// independent once the device + receive transport exist.
			const publishLocal = async () => {
				if (!mediaState.localStream) {
					return;
				}
				try {
					const videoTracks = mediaState.processedStream
						? mediaState.processedStream.getVideoTracks()
						: mediaState.localStream.getVideoTracks();

					const audioTracks = mediaState.localStream.getAudioTracks();

					const streamToPublish = new MediaStream([
						...videoTracks,
						...audioTracks,
					]);

					await manager!.publishMedia(streamToPublish, {
						publishVideo: mediaState.isCameraOn,
						publishAudio: mediaState.isMicOn,
					});
				} catch (error) {
					console.warn(
						"Media publishing failed, continuing without media:",
						(error as Error).message,
					);
				}
			};

			await Promise.all([
				publishLocal(),
				manager!.setupExistingParticipants(),
			]);
			if (await stopIfCancelled()) return;

			connectionState.isSetupComplete = true;
			if (wasAutomaticallyMuted) {
				const MicOffIcon = defineAsyncComponent(
					() => import("~icons/lucide/mic-off"),
				);
				toast("Mic muted automatically in large meetings.", {
					duration: 5000,
					icon: h(MicOffIcon),
				});
			}

			if (!guestName && (isHost || isCohost)) {
				fetchExistingWaitingRoomUsers();
			}
		} catch (error) {
			console.error("SFU setup failed:", error);
			await manager?.cleanup();
			if (sfuManager.value === manager) {
				sfuManager.value = null;
			}
			throw error;
		}
	};

	const fetchExistingWaitingRoomUsers = async () => {
		try {
			const result = normalizeWaitingRoomResponse(await frappeRequest({
				url: "suite.meet.api.meeting.get_waiting_room",
				params: { meeting_id: meetingId },
			}));

			if (result?.waiting_users) {
				const transformedUsers = result.waiting_users.map((user) => ({
					userId: user.user_id,
					name: user.full_name || user.user_id,
					avatar: user.user_image as string,
					isGuest: user.is_guest || false,
				}));

				lobbyStore.setLobbyUsers(transformedUsers);

				if (notifiedLobbyUsers.value) {
					for (const user of transformedUsers) {
						notifiedLobbyUsers.value.add(user.userId);
					}
				}
			}
		} catch (error) {
			console.error("Failed to fetch waiting room users:", error);
		}
	};

	const setupGuestApprovalListener = (guestName: string) => {
		const guestId = sessionStorage.getItem("guest_id");

		if (!guestId) {
			console.error("No guest_id found for realtime listener");
			return;
		}

		if (!socket) {
			console.error("Socket not available for guest approval listener");
			return;
		}

		socket.on("meet:guest_join_approved", handleGuestApproved);
		socket.on("meet:guest_join_rejected", handleGuestRejected);

		async function handleGuestApproved(value: unknown) {
			const event = normalizeGuestRealtimeEvent(value);
			if (event?.guestId !== guestId || event.meetingId !== meetingId) {
				return;
			}

			removeGuestApprovalListeners();

			lobbyStore.isWaitingForApproval = false;
			connectionState.isConnecting = true;

			try {
				const resolvedGuestName =
					guestName || sessionStorage.getItem("guest_name") || "Guest";
				const response = normalizeJoinPayload(await frappeRequest({
					url: "suite.meet.api.meeting.get_approved_guest_connection_details",
					params: {
						meeting_id: meetingId,
						guest_id: guestId,
					},
				}));
				if (
					response?.status === "joined" &&
					response.auth_token
				) {
					if (response.host_only_chat !== undefined) {
						chatStore.hostOnlyChat = response.host_only_chat;
					}

					if (response.recording !== undefined)
						onRecordingState?.(response.recording);
					connectionState.guestAuthToken = response.auth_token;
					connectionState.guestSfuUrl = response.sfu_url || null;
					connectionState.guestSfuPort =
						response.sfu_port == null ? null : String(response.sfu_port);

					const prefetched = connectionDetailsFromJoinPayload(response, {
						guestAuthToken: response.auth_token,
						guestId,
						guestName: resolvedGuestName,
						expectedMeetingId: meetingId,
					});
					await setupSFUConnection(
						resolvedGuestName,
						false,
						false,
						prefetched,
					);

					connectionState.isInPreview = false;
				} else {
					console.error(
						"Failed to get connection details after approval:",
						response,
					);
					connectionState.connectionError =
						"Failed to get authorization token after approval";
				}
			} catch (error) {
				console.error(
					"Error fetching connection details after approval:",
					error,
				);
				connectionState.connectionError = "Failed to connect after approval";
			} finally {
				connectionState.isConnecting = false;
			}
		}

		function handleGuestRejected(value: unknown) {
			const event = normalizeGuestRealtimeEvent(value);
			if (event?.guestId !== guestId || event.meetingId !== meetingId) {
				return;
			}

			removeGuestApprovalListeners();
			unsubscribeGuestRealtime();

			lobbyStore.isJoinRequestRejected = true;
			lobbyStore.isWaitingForApproval = false;

			toast.error("Your join request was denied by the meeting host");
		}
	};

	const removeGuestApprovalListeners = () => {
		if (!socket) return;

		socket.off("meet:guest_join_approved");
		socket.off("meet:guest_join_rejected");
	};

	const unsubscribeGuestRealtime = () => {
		const guestId = sessionStorage.getItem("guest_id");
		if (socket && guestId) socket.emit("guest_unsubscribe", guestId);
	};

	const handleMeetingJoinRequest = (value: unknown) => {
		const data = normalizeMeetingRealtimeEvent(value);
		if (data?.meeting === meetingId) {

			const userData = {
				userId: data.user,
				name: data.userName || data.user,
				avatar: data.userImage,
				requested_at: new Date().toISOString(),
			};

			lobbyStore.addLobbyUser(userData);

			audioNotificationManager.playJoinRequestNotification();
		}
	};

	const handleMeetingJoinApproved = async (value: unknown) => {
		const data = normalizeMeetingRealtimeEvent(value);
		const currentUserId = currentUser.currentUser.value?.user_id;

		if (data?.meeting === meetingId && data.user === currentUserId) {
			lobbyStore.isWaitingForApproval = false;

			try {
				const sfuResult = normalizeJoinPayload(await frappeRequest({
					url: "suite.meet.api.meeting.get_sfu_connection_details",
					params: {
						meeting_id: meetingId,
					},
				}));

				if (sfuResult) {
					onRecordingEnabled?.(!!sfuResult.recording_enabled);
					const prefetched = connectionDetailsFromJoinPayload(sfuResult, {
						expectedMeetingId: meetingId,
					});
					await setupSFUConnection(
						null,
						!!sfuResult.is_host,
						!!sfuResult.is_cohost,
						prefetched,
					);
					connectionState.isInPreview = false;
				} else {
					console.error("Failed to get SFU connection:", sfuResult);
					lobbyStore.isJoinRequestRejected = true;
					toast.error("Failed to join meeting after approval");
				}
			} catch (error) {
				console.error("Error after approval:", error);
				connectionState.connectionError = getErrorMessage(error);
				toast.error("Failed to join meeting after approval");
			}
		}
	};

	const handleMeetingJoinRejected = (value: unknown) => {
		const data = normalizeMeetingRealtimeEvent(value);
		const currentUserId = currentUser.currentUser.value?.user_id;

		if (data?.meeting === meetingId && data.user === currentUserId) {
			lobbyStore.isJoinRequestRejected = true;
			lobbyStore.isWaitingForApproval = false;

			toast.error("Your join request was denied by the meeting host");
		}
	};

	const handleMeetingUserApproved = (value: unknown) => {
		const data = normalizeMeetingRealtimeEvent(value);
		if (data?.meeting === meetingId) {
			lobbyStore.removeLobbyUser(data.user);
		}
	};

	const handleMeetingUserRejected = (value: unknown) => {
		const data = normalizeMeetingRealtimeEvent(value);
		if (data?.meeting === meetingId) {
			lobbyStore.removeLobbyUser(data.user);
		}
	};

	const setupFrappeRealtimeEventListeners = () => {
		if (realtimeListenersSetup.value) {
			return;
		}

		if (!socket) {
			console.warn("Socket not available for realtime events");
			return;
		}

		socket.on("meeting_join_request", handleMeetingJoinRequest);
		socket.on("meeting_join_approved", handleMeetingJoinApproved);
		socket.on("meeting_join_rejected", handleMeetingJoinRejected);
		socket.on("meeting_user_approved", handleMeetingUserApproved);
		socket.on("meeting_user_rejected", handleMeetingUserRejected);
		socket.on("meeting:e2ee_enabled", e2eeHandshake.handleMeetingE2EEEnabled);

		// SFU signal channel handlers and document listeners live in the
		// E2EE handshake composable; see useE2EEConnectionHandshake.
		e2eeHandshake.setupRealtimeEventListeners();

		realtimeListenersSetup.value = true;
	};

	const removeFrappeRealtimeEventListeners = () => {
		if (!socket) return;

		socket.off("meeting_join_request", handleMeetingJoinRequest);
		socket.off("meeting_join_approved", handleMeetingJoinApproved);
		socket.off("meeting_join_rejected", handleMeetingJoinRejected);
		socket.off("meeting_user_approved", handleMeetingUserApproved);
		socket.off("meeting_user_rejected", handleMeetingUserRejected);
		socket.off("meeting:e2ee_enabled", e2eeHandshake.handleMeetingE2EEEnabled);

		e2eeHandshake.teardownRealtimeEventListeners();
		e2eeHandshake.teardownForDisconnect();
	};

	const handleGuestJoinResult = async (
		joinResult: JoinPayload,
		guestName: string,
	) => {
		if (!guestName || !joinResult?.guest_id) {
			connectionState.connectionError =
				"Guest session not found. Please try joining again.";
			return;
		}

		try {
			connectionState.connectionError = null;

			sessionStorage.setItem("guest_id", joinResult.guest_id);
			sessionStorage.setItem("guest_name", guestName);
			sessionStorage.setItem("guest_meeting_id", meetingId);
			sessionStorage.setItem("guest_status", joinResult.status || "joined");
			socket?.emit("guest_subscribe", joinResult.guest_id);

			connectionState.guestId = joinResult.guest_id;
			connectionState.guestAuthToken =
				joinResult.auth_token || null;
			connectionState.guestSfuUrl = joinResult.sfu_url || null;
			connectionState.guestSfuPort =
				joinResult.sfu_port == null ? null : String(joinResult.sfu_port);

			if (joinResult.host_only_chat !== undefined) {
				chatStore.hostOnlyChat = !!joinResult.host_only_chat;
			}

			if (joinResult.status === "waiting_for_approval") {
				lobbyStore.isWaitingForApproval = true;
				connectionState.isInPreview = false;
				connectionState.isConnecting = false;
				connectionState.guestAuthToken = null;
				setupGuestApprovalListener(guestName);
				return;
			}
			if (joinResult.recording !== undefined)
				onRecordingState?.(joinResult.recording);

			// Show meeting shell immediately; SFU setup continues in the background.
			connectionState.isInPreview = false;
			connectionState.isConnecting = true;
			const prefetched = connectionDetailsFromJoinPayload(joinResult, {
				guestAuthToken: connectionState.guestAuthToken,
				guestId: connectionState.guestId,
				guestName,
				expectedMeetingId: meetingId,
			});
			await setupSFUConnection(guestName, false, false, prefetched);
			setupFrappeRealtimeEventListeners();
			connectionState.isConnecting = false;
		} catch (error) {
			console.error("Failed to complete guest join:", error);
			connectionState.connectionError = getErrorMessage(error);
			connectionState.isConnecting = false;
		}
	};

	const joinMeetingRoom = async () => {
		if (joiningInProgress.value) {
			return;
		}

		try {
			joiningInProgress.value = true;
			connectionState.isConnecting = true;
			connectionState.connectionError = null;
			// Optimistic UI: leave preview shell while join/SFU work runs.
			connectionState.isInPreview = false;

			connectionState.guestAuthToken = null;
			connectionState.guestSfuUrl = null;
			connectionState.guestSfuPort = null;

			const joinResult = normalizeJoinPayload(await joinMeetingAPI.fetch());
			if (!joinResult) throw new Error("Invalid meeting join response");

			if (joinResult.status === "waiting_for_approval") {
				lobbyStore.isWaitingForApproval = true;
				connectionState.isConnecting = false;
				setupFrappeRealtimeEventListeners();
				return;
			}

			if (joinResult?.host_only_chat !== undefined) {
				chatStore.hostOnlyChat = !!joinResult.host_only_chat;
			}
			onRecordingEnabled?.(!!joinResult.recording_enabled);

			const prefetched = connectionDetailsFromJoinPayload(joinResult, {
				expectedMeetingId: meetingId,
			});
			await setupSFUConnection(
				null,
				!!joinResult.is_host,
				!!joinResult.is_cohost,
				prefetched,
			);

			setupFrappeRealtimeEventListeners();
			connectionState.isConnecting = false;
		} catch (error) {
			console.error("Failed to join meeting:", error);
			connectionState.connectionError = getErrorMessage(error);
			connectionState.isConnecting = false;
		} finally {
			joiningInProgress.value = false;
		}
	};

	const endCall = async () => {
		try {
			setupCancelled = true;
			removeGuestApprovalListeners();
			unsubscribeGuestRealtime();

			if (activeSpeakerTimeout.value) {
				clearTimeout(activeSpeakerTimeout.value);
				activeSpeakerTimeout.value = null;
			}

			audioNotificationManager.playLeaveNotification(true);

			if (sfuManager.value) {
				await sfuManager.value.cleanup();
			}

			sfuManager.value = null;

			router.push({ name: "meet-home" });
		} catch (error) {
			console.error("Error ending call:", error);
			router.push({ name: "meet-home" });
		}
	};

	onUnmounted(async () => {
		setupCancelled = true;
		hasShownE2EEKeyMismatchToast.value = false;

		if (activeSpeakerTimeout.value) {
			clearTimeout(activeSpeakerTimeout.value);
			activeSpeakerTimeout.value = null;
		}
		if (stabilityCheckTimeout) {
			clearTimeout(stabilityCheckTimeout);
			stabilityCheckTimeout = null;
		}

		removeGuestApprovalListeners();
		unsubscribeGuestRealtime();
		removeFrappeRealtimeEventListeners();

		if (sfuManager.value) {
			await sfuManager.value.cleanup();
		}
		sfuManager.value = null;

		realtimeListenersSetup.value = false;
	});

	return {
		sfuClient,
		sfuManager,
		localNetworkQuality,
		joinMeetingRoom,
		handleGuestJoinResult,
		setupFrappeRealtimeEventListeners,
		endCall,
		fetchExistingWaitingRoomUsers,
	};
}
