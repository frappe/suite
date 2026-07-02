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
import { SFUClient } from "../utils/SFUClient";
import { SFUMeetingManager } from "../utils/SFUMeetingManager";
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

interface WaitingRoomResponse {
	waiting_users: Array<{
		user_id: string;
		full_name?: string;
		user_image?: string;
		is_guest?: boolean;
	}>;
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
		joinResult: Record<string, unknown>,
		guestName: string,
	) => Promise<void>;
	setupFrappeRealtimeEventListeners: () => void;
	endCall: () => Promise<void>;
	fetchExistingWaitingRoomUsers: () => Promise<void>;
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
	} = deps;

	const router = useRouter();
	const socket = useSocket();

	const chatStore = useChatStore();

	const signalChannel = new SocketIOSignalChannel();
	const sfuClient = new SFUClient(signalChannel);
	const sfuManager = shallowRef<SFUMeetingManager | null>(null);

	const realtimeListenersSetup = shallowRef(false);
	const joiningInProgress = shallowRef(false);
	const hasShownE2EEKeyMismatchToast = shallowRef(false);
	const isCurrentTabHost = shallowRef(false);

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
	let stabilityCheckTimeout: ReturnType<typeof setTimeout> | null = null;

	const handleParticipantJoined = (participant: Record<string, unknown>) => {
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
			participant.participantId as string,
		);

		const LucideUserIcon = defineAsyncComponent(
			() => import("~icons/lucide/user"),
		);

		toast.create({
			message: `${participantName} joined the meeting`,
			icon: participant.avatar
				? h("img", {
						src: participant.avatar as string,
						class: "w-6 h-6 rounded-full object-cover",
					})
				: h(LucideUserIcon, {
						class: "text-white",
					}),
			duration: 3,
		});
	};

	const handleParticipantLeft = ({
		participantId,
	}: {
		participantId: string;
	}) => {
		const participant = participantStore.participants[participantId] as
			| Record<string, unknown>
			| undefined;
		const participantName = participant?.user_name || participantId;

		participantStore.removeParticipant(participantId);

		if (participantId === currentUser.currentUser.value?.user_id) {
			return;
		}

		const LucideUserIcon = defineAsyncComponent(
			() => import("~icons/lucide/user"),
		);

		toast.create({
			message: `${participantName} left the meeting`,
			icon: participant?.avatar
				? h("img", {
						src: participant.avatar as string,
						class: "w-6 h-6 rounded-full object-cover",
					})
				: h(LucideUserIcon, {
						class: "text-white",
					}),
			duration: 3,
		});
	};

	const handleParticipantUpdated = (
		participantId: string,
		_participant: Record<string, unknown>,
		updates: Record<string, unknown>,
	) => {
		if (participantId) {
			participantStore.updateParticipant(participantId, updates || {});
		}
	};

	const createSFUEventHandlers = () => {
		return {
			onParticipantJoined: handleParticipantJoined,
			onParticipantLeft: handleParticipantLeft,
			onParticipantUpdated: handleParticipantUpdated,
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
	) => {
		let isHost = initialIsHost;
		let isCohost = initialIsCohost;
		isCurrentTabHost.value = isHost;
		if (connectionState.isSetupComplete) {
			connectionState.isInPreview = false;
			connectionState.isConnecting = false;
			return;
		}

		try {
			const manager = new SFUMeetingManager(sfuClient);
			manager.initialize({
				meetingId,
				currentUser: currentUser.currentUser.value,
				eventHandlers: createSFUEventHandlers(),
			});
			sfuManager.value = manager;

			// Register SFU signaling handlers before connect/join. E2EE joiners can
			// receive their host envelope immediately after sending their hello.
			setupFrappeRealtimeEventListeners();

			await manager.connect(connectionState.guestAuthToken);
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

			let userData: Record<string, unknown>;
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

			await manager.joinRoom(userData, {
				audio_enabled: mediaState.isMicOn,
				video_enabled: mediaState.isCameraOn,
			});
			if (sfuClient.isE2EERequired()) {
				await waitForE2EEContextReady(0);
			}

			await manager.initializeDevice();
			await manager.createReceiveTransport();

			if (mediaState.localStream) {
				try {
					const videoTracks = mediaState.processedStream
						? mediaState.processedStream.getVideoTracks()
						: mediaState.localStream.getVideoTracks();

					const audioTracks = mediaState.localStream.getAudioTracks();

					const streamToPublish = new MediaStream([
						...videoTracks,
						...audioTracks,
					]);

					await manager.publishMedia(streamToPublish, {
						publishVideo: mediaState.isCameraOn,
						publishAudio: mediaState.isMicOn,
					});
				} catch (error) {
					console.warn(
						"Media publishing failed, continuing without media:",
						(error as Error).message,
					);
				}
			}

			await manager.setupExistingParticipants();

			connectionState.isSetupComplete = true;

			if (!guestName && (isHost || isCohost)) {
				fetchExistingWaitingRoomUsers();
			}
		} catch (error) {
			console.error("SFU setup failed:", error);
			throw error;
		}
	};

	const fetchExistingWaitingRoomUsers = async () => {
		try {
			const result = (await frappeRequest({
				url: "suite.meet.api.meeting.get_waiting_room",
				params: { meeting_id: meetingId },
			})) as WaitingRoomResponse;

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

		socket.emit("guest_subscribe", guestId);

		socket.on("meet:guest_join_approved", handleGuestApproved);
		socket.on("meet:guest_join_rejected", handleGuestRejected);

		async function handleGuestApproved(data: Record<string, unknown>) {
			if (data.guest_id !== guestId || data.meeting_id !== meetingId) {
				return;
			}

			stopGuestApprovalListener();

			lobbyStore.isWaitingForApproval = false;

			try {
				const resolvedGuestName =
					guestName || sessionStorage.getItem("guest_name") || "Guest";
				const response = await frappeRequest({
					url: "suite.meet.api.meeting.get_approved_guest_connection_details",
					params: {
						meeting_id: meetingId,
						guest_id: guestId,
					},
				});
				if (
					(response as Record<string, unknown>)?.status === "joined" &&
					(response as Record<string, unknown>).auth_token
				) {
					if (
						(response as Record<string, unknown>).host_only_chat !== undefined
					) {
						chatStore.hostOnlyChat = !!(response as Record<string, unknown>)
							.host_only_chat;
					}

					connectionState.guestAuthToken = (response as Record<string, unknown>)
						.auth_token as string;
					connectionState.guestSfuUrl =
						((response as Record<string, unknown>).sfu_url as string) || null;
					connectionState.guestSfuPort =
						((response as Record<string, unknown>).sfu_port as string) || null;

					await setupSFUConnection(resolvedGuestName);

					connectionState.isInPreview = false;
					connectionState.isConnecting = false;
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
			}
		}

		function handleGuestRejected(data: Record<string, unknown>) {
			if (
				(data as Record<string, unknown>).guest_id !== guestId ||
				(data as Record<string, unknown>).meeting_id !== meetingId
			) {
				return;
			}

			stopGuestApprovalListener();

			lobbyStore.isJoinRequestRejected = true;
			lobbyStore.isWaitingForApproval = false;

			toast.error("Your join request was denied by the meeting host");
		}
	};

	const stopGuestApprovalListener = () => {
		if (!socket) return;

		const guestId = sessionStorage.getItem("guest_id");

		if (guestId) {
			socket.emit("guest_unsubscribe", guestId);
		}

		socket.off("meet:guest_join_approved");
		socket.off("meet:guest_join_rejected");
	};

	const handleMeetingJoinRequest = (data: Record<string, unknown>) => {
		if (data.meeting === meetingId) {
			if (!data.user) {
				return;
			}

			const userData = {
				userId: data.user as string,
				name: (data.user_name || data.user) as string,
				avatar: data.user_image as string,
				requested_at: new Date().toISOString(),
			};

			lobbyStore.addLobbyUser(userData);

			audioNotificationManager.playJoinRequestNotification();
		}
	};

	const handleMeetingJoinApproved = async (data: Record<string, unknown>) => {
		const currentUserId = currentUser.currentUser.value?.user_id;

		if (data.meeting === meetingId && data.user === currentUserId) {
			lobbyStore.isWaitingForApproval = false;

			try {
				const sfuResult = await frappeRequest({
					url: "suite.meet.api.meeting.get_sfu_connection_details",
					params: {
						meeting_id: meetingId,
					},
				});

				if (sfuResult) {
					await setupSFUConnection(
						null,
						(sfuResult as Record<string, unknown>).is_host as boolean,
						(sfuResult as Record<string, unknown>).is_cohost as boolean,
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

	const handleMeetingJoinRejected = (data: Record<string, unknown>) => {
		const currentUserId = currentUser.currentUser.value?.user_id;

		if (data.meeting === meetingId && data.user === currentUserId) {
			lobbyStore.isJoinRequestRejected = true;
			lobbyStore.isWaitingForApproval = false;

			toast.error("Your join request was denied by the meeting host");
		}
	};

	const handleMeetingUserApproved = (data: Record<string, unknown>) => {
		if (data.meeting === meetingId) {
			lobbyStore.removeLobbyUser(data.user as string);
		}
	};

	const handleMeetingUserRejected = (data: Record<string, unknown>) => {
		if (data.meeting === meetingId) {
			lobbyStore.removeLobbyUser(data.user as string);
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
		joinResult: Record<string, unknown>,
		guestName: string,
	) => {
		if (!guestName || !joinResult?.guest_id) {
			connectionState.connectionError =
				"Guest session not found. Please try joining again.";
			return;
		}

		try {
			connectionState.connectionError = null;

			sessionStorage.setItem("guest_id", joinResult.guest_id as string);
			sessionStorage.setItem("guest_name", guestName);
			sessionStorage.setItem("guest_meeting_id", meetingId);
			sessionStorage.setItem("guest_status", joinResult.status as string);

			connectionState.guestId = joinResult.guest_id as string;
			connectionState.guestAuthToken =
				(joinResult.auth_token as string) || null;
			connectionState.guestSfuUrl = (joinResult.sfu_url as string) || null;
			connectionState.guestSfuPort = (joinResult.sfu_port as string) || null;

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

			connectionState.isConnecting = true;
			await setupSFUConnection(guestName, false, false);
			setupFrappeRealtimeEventListeners();
			connectionState.isInPreview = false;
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

			connectionState.guestAuthToken = null;
			connectionState.guestSfuUrl = null;
			connectionState.guestSfuPort = null;

			const response = (await joinMeetingAPI.fetch()) as
				| Record<string, unknown>
				| { message?: Record<string, unknown> };
			const joinResult = (
				"message" in response && response.message ? response.message : response
			) as Record<string, unknown>;

			if (joinResult.status === "waiting_for_approval") {
				lobbyStore.isWaitingForApproval = true;
				connectionState.isInPreview = false;
				connectionState.isConnecting = false;
				setupFrappeRealtimeEventListeners();
				return;
			}

			await setupSFUConnection(
				null,
				(joinResult?.is_host || false) as boolean,
				(joinResult?.is_cohost || false) as boolean,
			);

			if (joinResult?.host_only_chat !== undefined) {
				chatStore.hostOnlyChat = !!joinResult.host_only_chat;
			}

			setupFrappeRealtimeEventListeners();
			connectionState.isInPreview = false;
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
			stopGuestApprovalListener();

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
		hasShownE2EEKeyMismatchToast.value = false;

		if (activeSpeakerTimeout.value) {
			clearTimeout(activeSpeakerTimeout.value);
			activeSpeakerTimeout.value = null;
		}
		if (stabilityCheckTimeout) {
			clearTimeout(stabilityCheckTimeout);
			stabilityCheckTimeout = null;
		}

		stopGuestApprovalListener();
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
		joinMeetingRoom,
		handleGuestJoinResult,
		setupFrappeRealtimeEventListeners,
		endCall,
		fetchExistingWaitingRoomUsers,
	};
}
