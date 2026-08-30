import { createResource, dialog, frappeRequest, toast } from "frappe-ui";
import {
	defineAsyncComponent,
	computed,
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
	type AttachmentTrackOwnership,
	VideoElementManager,
} from "../utils/media/VideoElementManager";
import {
	type ConnectionDetails,
	connectionDetailsFromJoinPayload,
	SFUClient,
	SFUResponseError,
} from "../utils/SFUClient";
import { SFUMeetingManager } from "../utils/SFUMeetingManager";
import { getClientTelemetry } from "../utils/telemetry/ClientTelemetry";
import { useChatStore } from "./useChatStore";
import {
	clearGuestSession,
	readGuestSession,
	setCurrentGuestIdentity,
	shouldAutoConnectAdmittedGuest,
	type StoredGuestSession,
	writeGuestSession,
	type ConnectionState,
	type GuestSessionStatus,
} from "./useConnectionState";
import {
	createGuestRealtimeLifecycle,
	getApprovedGuestConnectionDetails,
} from "./useGuestRealtime";
import type { CurrentUser } from "./useCurrentUser";
import {
	type E2EEConnectionHandshake,
	useE2EEConnectionHandshake,
} from "./useE2EEConnectionHandshake";
import type { GridLayout } from "./useGridLayout";
import type { LobbyStore } from "./useLobbyStore";
import type { MediaState } from "./useMediaState";
import type { ParticipantStore } from "./useParticipantStore";
import { useParticipantConnectionState } from "./useParticipantConnectionState";
import type { RecoveryTimelineEntry } from "./useParticipantConnectionState";
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
import type {
	ParticipantConnectionState,
	SFUEventHandlers,
} from "../utils/sfu/ParticipantConnection";

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

function getParticipantConnectionConflictId(error: unknown): string | null {
	if (
		!(error instanceof SFUResponseError) ||
		error.code !== "PARTICIPANT_CONNECTION_CONFLICT"
	) {
		return null;
	}
	return typeof error.details?.conflictId === "string"
		? error.details.conflictId
		: null;
}

export interface SFUScreenShareData {
	participantId?: string;
	producerId?: string;
	consumer?: { id: string; producerId?: string };
	startedAt?: number;
	stream?: MediaStream;
}

interface SFUConnectionAPI {
	sfuClient: SFUClient;
	sfuManager: Ref<SFUMeetingManager | null>;
	joinMeetingRoom: (options?: { switchHere?: boolean }) => Promise<void>;
	handleGuestJoinResult: (
		joinResult: JoinPayload,
		guestName: string,
	) => Promise<void>;
	setupFrappeRealtimeEventListeners: () => void;
	endCall: () => Promise<void>;
	fetchExistingWaitingRoomUsers: () => Promise<void>;
	localNetworkQuality: Ref<string>;
	lifecycleState: Ref<ParticipantConnectionState>;
	isConnecting: Ref<boolean>;
	isSetupComplete: Ref<boolean>;
	recoveryTimeline: Ref<RecoveryTimelineEntry[]>;
	registerRemoteVideoElement: (
		participantId: string,
		element: HTMLVideoElement | null,
	) => void;
	registerLocalPreview: (element: HTMLVideoElement | null) => void;
	attachLocalPreview: (stream: MediaStream | null) => Promise<void>;
	registerScreenSharePreview: (
		attachmentId: string,
		element: HTMLVideoElement | null,
	) => void;
	attachScreenSharePreview: (
		attachmentId: string,
		stream: MediaStream,
		trackOwnership?: AttachmentTrackOwnership,
	) => Promise<void>;
	removeScreenSharePreview: (attachmentId: string) => void;
	attachBackgroundEffectsSource: (
		attachmentId: string,
		element: HTMLVideoElement,
		stream: MediaStream,
	) => Promise<void>;
	removeBackgroundEffectsSource: (attachmentId: string) => void;
	setAudioOutputDevice: (deviceId: string) => Promise<void>;
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
	onParticipantConnectionReplaced: () => void | Promise<void>;
	onScreenShareStarted: (data: SFUScreenShareData) => void;
	onScreenShareStopped: (data: SFUScreenShareData) => void;
	onActiveSpeakerChanged: (participantIds: string[]) => void;
	onRecordingState?: (recording: RecordingState | null) => void;
	onRecordingEnabled?: (enabled: boolean) => void;
	onCohostPromoted?: () => Promise<void>;
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
		onParticipantConnectionReplaced,
		onScreenShareStarted,
		onScreenShareStopped,
		onActiveSpeakerChanged,
		onRecordingState,
		onRecordingEnabled,
		onCohostPromoted,
	} = deps;

	const router = useRouter();
	const socket = useSocket();

	const chatStore = useChatStore();
	const participantConnectionState = useParticipantConnectionState();
	participantConnectionState.$reset();

	const signalChannel = new SocketIOSignalChannel();
	const sfuClient = new SFUClient(signalChannel);
	const videoManager = new VideoElementManager();
	const clientTelemetry = getClientTelemetry(sfuClient);
	const sfuManager = shallowRef<SFUMeetingManager | null>(null);

	const realtimeListenersSetup = shallowRef(false);
	const joiningInProgress = shallowRef(false);
	const hasShownE2EEKeyMismatchToast = shallowRef(false);
	const isCurrentTabHost = shallowRef(false);
	const confirmParticipantConnectionSwitch = () =>
		new Promise<boolean>((resolve) => {
			dialog.confirm({
				title: "Switch to this device?",
				message:
					"You're already in this meeting on another device. Continuing will move the meeting here.",
				confirmLabel: "Switch to this device",
				cancelLabel: "Cancel",
				onConfirm: () => resolve(true),
				onCancel: () => resolve(false),
			});
		});

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
	const isConnecting = computed(
		() => joiningInProgress.value || participantConnectionState.isConnecting,
	);
	const isSetupComplete = computed(
		() => participantConnectionState.isSetupComplete,
	);
	let stabilityCheckTimeout: ReturnType<typeof setTimeout> | null = null;
	let preserveGuestSessionOnEnd = false;

	const markGuestSessionStatus = (status: GuestSessionStatus) => {
		const guestSession = readGuestSession(meetingId);
		if (guestSession) writeGuestSession({ ...guestSession, status });
		lobbyStore.isJoinRequestRejected = true;
		lobbyStore.isWaitingForApproval = false;
	};

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

		if (
			isRejoin ||
			participantConnectionState.lifecycleState === "syncing"
		) {
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

	const createSFUEventHandlers = (): SFUEventHandlers => {
		return {
			onRecoveryExhausted: (trigger) => {
				clientTelemetry.reportRecoveryExhausted({
					subsystem:
						trigger?.scope === "subscription"
							? "consumer"
							: trigger?.scope === "transport" || trigger?.scope === "publication"
								? "transport"
								: "signaling",
					direction: trigger?.direction ?? "both",
					reason: "rebuild_failed",
				});
			},
			onRecoveryStateChange: (
				state: Parameters<typeof participantConnectionState.recordRecovery>[0],
				detail?: string,
			) => {
				participantConnectionState.recordRecovery(state, detail);
				clientTelemetry.recordRecoveryState(state, detail);
			},
			onLifecycleStateChange: (state) => {
				participantConnectionState.setLifecycleState(state);
				if (state === "failed") {
					connectionState.connectionError =
						"We couldn't restore your meeting connection. Try joining again.";
				}
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
			onHostKickedYou: (data: { hostId?: string; banned?: boolean }) => {
				if (data.banned) {
					preserveGuestSessionOnEnd = true;
					markGuestSessionStatus("banned");
					toast.error("You have been banned from this meeting by the host");
				} else {
					toast.error("You have been removed from the meeting by the host");
				}
				onHostKickedYou();
			},
			onParticipantConnectionReplaced: async () => {
				connectionState.connectionMoved = true;
				await onParticipantConnectionReplaced();
			},
		};
	};

	const setupSFUConnection = async (
		guestName: string | null = null,
		initialIsHost = false,
		initialIsCohost = false,
		prefetchedDetails: ConnectionDetails | null = null,
		conflictId?: string,
		switchHere = false,
	) => {
		clientTelemetry.startSession();
		let isHost = initialIsHost;
		let isCohost = initialIsCohost;
		let manager: SFUMeetingManager | null = null;
		isCurrentTabHost.value = isHost;
		if (participantConnectionState.isSetupComplete) {
			connectionState.isInPreview = false;
			return;
		}

		try {
			let wasAutomaticallyMuted = false;
			const wantsAudio = mediaState.isMicOn;
			manager = new SFUMeetingManager(sfuClient, videoManager);
			manager.initialize({
				meetingId,
				currentUser: currentUser.currentUser.value,
				eventHandlers: createSFUEventHandlers(),
			});
			sfuManager.value = manager;

			// Register SFU signaling handlers before connect/join. E2EE joiners can
			// receive their host envelope immediately after sending their hello.
			setupFrappeRealtimeEventListeners();

			await manager.startParticipantConnection({
				authToken: connectionState.guestAuthToken,
				prefetchedDetails,
				conflictId,
				prepareJoin: async (signal) => {
					if (signal.aborted) throw signal.reason;
					connectionState.codecStrategy = sfuClient.getCodecStrategy() || "svc";
					if (!guestName) {
						isHost = sfuClient.connectionDetails.isHost || isHost;
						isCohost = sfuClient.connectionDetails.isCohost || isCohost;
						isCurrentTabHost.value = isHost;
					}
					if (
						sfuClient.isE2EERequired() &&
						!sfuClient.isInsertableStreamsSupported()
					) {
						throw new Error(
							"This meeting requires E2EE, but your browser does not support encoded insertable streams.",
						);
					}
					const userData: JoinUserData = guestName
						? {
								name: guestName,
								userId: connectionState.guestId || "",
								avatar: null,
								is_guest: true,
								isHost: false,
							}
						: {
								name:
									currentUser.currentUser.value?.full_name ||
									currentUser.currentUser.value?.name ||
									"You",
								userId: currentUser.currentUser.value?.user_id || "",
								avatar: currentUser.currentUser.value?.avatar || "",
								is_guest: false,
								isHost,
							};
					return {
						userData,
						mediaState: {
							audio_enabled: false,
							video_enabled: false,
						},
					};
				},
				waitForE2EEReady: async () => {
					await waitForE2EEContextReady(0);
				},
				publishLocalMedia: async (signal) => {
					if (wantsAudio) {
						let shouldMute = true;
						try {
							const participants = await sfuClient.getRoomParticipants();
							if (signal.aborted) throw signal.reason;
							shouldMute =
								participants.length > LARGE_MEETING_PARTICIPANT_THRESHOLD;
						} catch (error) {
							if (signal.aborted) throw error;
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
						}
					}
					const publishVideo = mediaState.isCameraOn;
					const publishAudio = mediaState.isMicOn;
					const localStream = mediaState.localStream;
					if (!localStream) {
						mediaState.isCameraOn = false;
						mediaState.isMicOn = false;
						return;
					}
					const videoTracks = mediaState.processedStream
						? mediaState.processedStream.getVideoTracks()
						: localStream.getVideoTracks();
					const streamToPublish = new MediaStream([
						...videoTracks,
						...localStream.getAudioTracks(),
					]);
					await manager!.publishInitialMedia(
						streamToPublish,
						{ publishVideo, publishAudio },
						signal,
						(publication) => {
							const videoStillRequested = publishVideo && mediaState.isCameraOn;
							const audioStillRequested = publishAudio && mediaState.isMicOn;
							if (videoStillRequested && publication.videoProducer) {
								sfuClient.sendMediaControl("video_on");
							}
							if (audioStillRequested && publication.audioProducer) {
								sfuClient.sendMediaControl("unmute");
							}
							if (
								(videoStillRequested && !publication.videoProducer) ||
								(audioStillRequested && !publication.audioProducer)
							) {
								console.warn("Initial media publication did not fully recover", {
									video: publication.videoError
										? getErrorMessage(publication.videoError)
										: undefined,
									audio: publication.audioError
										? getErrorMessage(publication.audioError)
										: undefined,
								});
								toast.error(
									"Some media could not be started. Trying to restore your connection.",
								);
								throw new Error("Initial media publication recovery exhausted");
							}
						}
					);
				},
			});
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
			if (isUnknownRecord(error) && error.name === "AbortError") {
				if (sfuManager.value === manager) sfuManager.value = null;
				return;
			}
			const nextConflictId = getParticipantConnectionConflictId(error);
			if (nextConflictId) {
				connectionState.connectionError = null;
				await manager?.cleanup();
				if (sfuManager.value === manager) sfuManager.value = null;
				if (!switchHere && !(await confirmParticipantConnectionSwitch())) {
					connectionState.isInPreview = true;
					return;
				}
				return setupSFUConnection(
					guestName,
					initialIsHost,
					initialIsCohost,
					prefetchedDetails,
					nextConflictId,
					false,
				);
			}
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

	let approvedGuestConnectionPromise: Promise<void> | null = null;
	const connectAdmittedGuest = (guestSession: StoredGuestSession) => {
		if (approvedGuestConnectionPromise) return approvedGuestConnectionPromise;
		approvedGuestConnectionPromise = (async () => {
			joiningInProgress.value = true;
			try {
				const response = await getApprovedGuestConnectionDetails(guestSession);
				const currentSession = readGuestSession(meetingId);
				if (
					!currentSession ||
					currentSession.guestId !== guestSession.guestId ||
					currentSession.guestSessionToken !== guestSession.guestSessionToken ||
					currentSession.status === "rejected" ||
					currentSession.status === "banned" ||
					currentSession.status === "expired"
				) return;
				const admittedSession = {
					...guestSession,
					guestName: response.guest_name || guestSession.guestName,
					status: "admitted" as const,
				};
				writeGuestSession(admittedSession);
				setCurrentGuestIdentity(currentUser, admittedSession);
				lobbyStore.isWaitingForApproval = false;
				connectionState.guestId = admittedSession.guestId;
				connectionState.guestSessionToken = admittedSession.guestSessionToken;
				connectionState.guestAuthToken = response.auth_token;
				connectionState.guestSfuUrl = response.sfu_url || null;
				connectionState.guestSfuPort =
					response.sfu_port == null ? null : String(response.sfu_port);
				if (response.host_only_chat !== undefined) {
					chatStore.hostOnlyChat = response.host_only_chat;
				}
				if (response.recording !== undefined) onRecordingState?.(response.recording);
				if (participantConnectionState.isSetupComplete) return;

				const prefetched = connectionDetailsFromJoinPayload(response, {
					guestAuthToken: response.auth_token,
					guestId: admittedSession.guestId,
					guestName: admittedSession.guestName,
					expectedMeetingId: meetingId,
				});
				await setupSFUConnection(
					admittedSession.guestName,
					false,
					false,
					prefetched,
				);
			} catch (error) {
				console.error("Error connecting admitted guest:", error);
				connectionState.connectionError = getErrorMessage(error);
				toast.error("Could not verify your guest admission. Please try again.");
			} finally {
				joiningInProgress.value = false;
				approvedGuestConnectionPromise = null;
			}
		})();
		return approvedGuestConnectionPromise;
	};

	const handleGuestStatus = (
		status: "pending" | "admitted",
		guestSession: StoredGuestSession,
	) => {
		if (status === "admitted") {
			if (shouldAutoConnectAdmittedGuest(guestSession)) {
				return connectAdmittedGuest(guestSession);
			}
			const admittedSession = { ...guestSession, status: "admitted" as const };
			writeGuestSession(admittedSession);
			setCurrentGuestIdentity(currentUser, admittedSession);
			connectionState.guestId = admittedSession.guestId;
			connectionState.guestSessionToken = admittedSession.guestSessionToken;
			return;
		}
		writeGuestSession({ ...guestSession, status: "pending" });
		setCurrentGuestIdentity(currentUser, guestSession);
		lobbyStore.isWaitingForApproval = true;
	};

	const handleTerminalGuestStatus = (
		status: "rejected" | "banned" | "expired",
	) => {
		markGuestSessionStatus(status);
		const messages = {
			rejected: "Your join request was denied by the meeting host",
			banned: "You have been banned from this meeting",
			expired: "Your guest session has expired",
		};
		toast.error(messages[status]);
	};

	const guestRealtime = createGuestRealtimeLifecycle({
		socket,
		meetingId,
		readSession: () => readGuestSession(meetingId),
		onActiveStatus: handleGuestStatus,
		onTerminalStatus: handleTerminalGuestStatus,
		onError: (error) => {
			console.error("Guest realtime subscription failed:", error);
			connectionState.connectionError = error.message;
			toast.error("Could not verify your guest session. Please reconnect.");
		},
	});
	guestRealtime.start();

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

	const handleCohostPromoted = async (value: unknown) => {
		const data = normalizeMeetingRealtimeEvent(value);
		const currentUserId = currentUser.currentUser.value?.user_id;
		if (data?.meeting !== meetingId || data.user !== currentUserId) return;

		try {
			await Promise.all([
				sfuClient.refreshToken({ forceNewRequest: true }),
				onCohostPromoted?.(),
			]);
			toast.success("You are now a co-host");
		} catch (error) {
			console.error("Failed to activate co-host permissions:", error);
			toast.error("Could not activate co-host permissions");
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
		socket.on("meeting:cohost_promoted", handleCohostPromoted);
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
		socket.off("meeting:cohost_promoted", handleCohostPromoted);
		socket.off("meeting:e2ee_enabled", e2eeHandshake.handleMeetingE2EEEnabled);

		e2eeHandshake.teardownRealtimeEventListeners();
		e2eeHandshake.teardownForDisconnect();
	};

	const handleGuestJoinResult = async (
		joinResult: JoinPayload,
		guestName: string,
	) => {
		if (!guestName || !joinResult?.guest_id || !joinResult.guest_session_token) {
			connectionState.connectionError =
				"Guest session not found. Please try joining again.";
			return;
		}

		try {
			connectionState.connectionError = null;
			if (
				joinResult.status === "rejected" ||
				joinResult.status === "banned" ||
				joinResult.status === "expired"
			) {
				const terminalSession = {
					guestId: joinResult.guest_id,
					guestSessionToken: joinResult.guest_session_token,
					meetingId,
					guestName: joinResult.guest_name || guestName,
					status: joinResult.status,
				};
				writeGuestSession(terminalSession);
				setCurrentGuestIdentity(currentUser, terminalSession);
				handleTerminalGuestStatus(joinResult.status);
				return;
			}

			const guestSession = {
				guestId: joinResult.guest_id,
				guestSessionToken: joinResult.guest_session_token,
				meetingId,
				guestName: joinResult.guest_name || guestName,
				status:
					joinResult.status === "waiting_for_approval"
						? ("pending" as const)
						: ("admitted" as const),
			};
			writeGuestSession(guestSession);
			setCurrentGuestIdentity(currentUser, guestSession);

			connectionState.guestId = joinResult.guest_id;
			connectionState.guestSessionToken = joinResult.guest_session_token;
			connectionState.guestAuthToken =
				joinResult.auth_token || null;
			connectionState.guestSfuUrl = joinResult.sfu_url || null;
			connectionState.guestSfuPort =
				joinResult.sfu_port == null ? null : String(joinResult.sfu_port);

			if (joinResult.host_only_chat !== undefined) {
				chatStore.hostOnlyChat = !!joinResult.host_only_chat;
			}

			if (joinResult.status === "waiting_for_approval") {
				guestRealtime.start();
				lobbyStore.isWaitingForApproval = true;
				connectionState.isInPreview = false;
				connectionState.guestAuthToken = null;
				return;
			}
			if (joinResult.recording !== undefined)
				onRecordingState?.(joinResult.recording);

			// Show meeting shell immediately; SFU setup continues in the background.
			connectionState.isInPreview = false;
			joiningInProgress.value = true;
			const prefetched = connectionDetailsFromJoinPayload(joinResult, {
				guestAuthToken: connectionState.guestAuthToken,
				guestId: connectionState.guestId,
				guestName: guestSession.guestName,
				expectedMeetingId: meetingId,
			});
			await setupSFUConnection(guestSession.guestName, false, false, prefetched);
			guestRealtime.start();
			setupFrappeRealtimeEventListeners();
		} catch (error) {
			console.error("Failed to complete guest join:", error);
			connectionState.connectionError = getErrorMessage(error);
		} finally {
			joiningInProgress.value = false;
		}
	};

	const joinMeetingRoom = async (options: { switchHere?: boolean } = {}) => {
		if (joiningInProgress.value) {
			return;
		}

		try {
			joiningInProgress.value = true;
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
				undefined,
				!!options.switchHere,
			);

			setupFrappeRealtimeEventListeners();
		} catch (error) {
			console.error("Failed to join meeting:", error);
			connectionState.connectionError = getErrorMessage(error);
		} finally {
			joiningInProgress.value = false;
		}
	};

	const endCall = async () => {
		try {
			guestRealtime.stop();

			if (activeSpeakerTimeout.value) {
				clearTimeout(activeSpeakerTimeout.value);
				activeSpeakerTimeout.value = null;
			}

			audioNotificationManager.playLeaveNotification(true);

			if (sfuManager.value) {
				await sfuManager.value.cleanup();
			}

			sfuManager.value = null;
			if (
				!preserveGuestSessionOnEnd &&
				readGuestSession(meetingId)?.status !== "banned"
			) clearGuestSession();

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

		guestRealtime.stop();
		removeFrappeRealtimeEventListeners();

		try {
			if (sfuManager.value) await sfuManager.value.cleanup();
			sfuManager.value = null;
		} finally {
			videoManager.cleanup();
		}

		realtimeListenersSetup.value = false;
	});

	return {
		sfuClient,
		sfuManager,
		localNetworkQuality,
		lifecycleState: computed(
			() => participantConnectionState.lifecycleState,
		),
		isConnecting,
		isSetupComplete,
		recoveryTimeline: computed(
			() => participantConnectionState.recoveryTimeline,
		),
		registerRemoteVideoElement: (participantId, element) =>
			videoManager.registerRemoteVideoElement(participantId, element),
		registerLocalPreview: (element) =>
			videoManager.registerLocalPreview(element),
		attachLocalPreview: (stream) => videoManager.attachLocalPreview(stream),
		registerScreenSharePreview: (attachmentId, element) =>
			videoManager.registerScreenSharePreview(attachmentId, element),
		attachScreenSharePreview: (attachmentId, stream, trackOwnership) =>
			videoManager.attachScreenSharePreview(
				attachmentId,
				stream,
				trackOwnership,
			),
		removeScreenSharePreview: (attachmentId) =>
			videoManager.removeScreenSharePreview(attachmentId),
		attachBackgroundEffectsSource: (attachmentId, element, stream) =>
			videoManager.attachBackgroundEffectsSource(attachmentId, element, stream),
		removeBackgroundEffectsSource: (attachmentId) =>
			videoManager.removeBackgroundEffectsSource(attachmentId),
		setAudioOutputDevice: (deviceId) =>
			videoManager.setAudioOutputDevice(deviceId),
		joinMeetingRoom,
		handleGuestJoinResult,
		setupFrappeRealtimeEventListeners,
		endCall,
		fetchExistingWaitingRoomUsers,
	};
}
