import { createResource } from "frappe-ui";
import { io, type Socket } from "socket.io-client";
import { computed, onUnmounted, readonly, ref } from "vue";
import { session } from "@/boot/session";
import type {
	FrappeRequestError,
	ParticipantJoinedEvent,
	ParticipantLeftEvent,
	ParticipantPreview,
	PresenceJoinResponse,
	PresenceParticipantsResponse,
	PresenceTokenResponse,
} from "../types";

export function useMeetingPreviewPresence(meetingId: string) {
	const participants = ref<ParticipantPreview[]>([]);
	const error = ref<string | null>(null);
	let socket: Socket | null = null;
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	let isRefreshing = false;

	const scheduleTokenRefresh = (expiresIn: number) => {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
		}

		// refresh at 90% of token expires
		const refreshAfter = Math.max(Math.floor(expiresIn * 0.9), 10) * 1000;

		refreshTimer = setTimeout(async () => {
			if (isRefreshing || !socket) return;
			isRefreshing = true;

			console.log("Refreshing preview presence token");
			await fetchPresenceToken.fetch();
			isRefreshing = false;
		}, refreshAfter);
	};

	const fetchPresenceToken = createResource({
		url: "suite.meet.api.meeting.get_sfu_presence_preview_token",
		params: { meeting_id: meetingId },
		auto: false,
		onSuccess(data: PresenceTokenResponse) {
			if (data && (data.auth_token || data.sfu_url)) {
				connectToSFU(data);
			} else {
				error.value = data.error || "Failed to get presence token";
			}
		},
		onError(err: FrappeRequestError) {
			error.value = err.messages?.length
				? err.messages[err.messages.length - 1]
				: "Failed to fetch presence token";
		},
	});

	if (session.isLoggedIn) {
		fetchPresenceToken.fetch();
	}

	const connectToSFU = (tokenData: PresenceTokenResponse) => {
		if (!tokenData.sfu_url || !tokenData.auth_token) {
			error.value = "Invalid token data";
			return;
		}

		// not initial connection, just update token and reconnect
		if (socket) {
			socket.auth = { token: tokenData.auth_token };
			socket.disconnect();
			socket.connect();

			// schedule next refresh
			if (tokenData.expires_in) {
				scheduleTokenRefresh(tokenData.expires_in);
			}
			return;
		}

		// initial connection (socket doesn't exist)
		let sfuUrl: string;
		const urlObj = new URL(tokenData.sfu_url);
		const isSecured = urlObj.protocol === "https:";

		if (isSecured) {
			sfuUrl = urlObj.origin;
		} else {
			sfuUrl = `${urlObj.protocol}//${urlObj.hostname}:${tokenData.sfu_port || 3000}`;
		}

		socket = io(sfuUrl, {
			auth: { token: tokenData.auth_token },
			transports: ["websocket", "polling"],
		});

		// ts doesn't understand that socket is non-null in callbacks
		// we use a local reference to avoid null checks
		const currentSocket = socket;

		currentSocket.on("connect", () => {
			currentSocket.emit(
				"join_room",
				{
					roomId: meetingId,
					userData: {
						name: "Preview",
						userId: `preview-${Date.now()}`,
						avatar: null,
					},
					mediaState: {
						audio_enabled: false,
						video_enabled: false,
					},
				},
				// keep callback since we do evoke it
				(joinResponse: PresenceJoinResponse) => {
					if (!joinResponse.success) {
						console.error(
							"Failed to join room for presence preview:",
							joinResponse.error,
						);
					}
				},
			);

			currentSocket.emit(
				"get_room_participants",
				{},
				(response: PresenceParticipantsResponse) => {
					if (response.success && response.participants) {
						participants.value = response.participants.map((p) => ({
							user_id: p.info.userId || p.user_id || p.id,
							full_name: p.info.name || p.user_id || p.id,
							avatar_url: p.info.avatar,
							has_video: p.info.video_enabled || false,
							has_audio: p.info.audio_enabled || false,
							is_guest: p.info.is_guest || false,
						}));
					} else {
						error.value = response.error || "Failed to fetch participants";
					}
				},
			);
		});

		currentSocket.on("connect_error", (err: Error) => {
			error.value = err.message || "Failed to connect to SFU";
		});

		currentSocket.on("participant_joined", (data: ParticipantJoinedEvent) => {
			const newParticipant: ParticipantPreview = {
				user_id: data.userData.userId,
				full_name: data.userData.name || data.userData.userId,
				avatar_url: data.userData.avatar,
				has_video: data.userData.video_enabled,
				has_audio: data.userData.audio_enabled,
				is_guest: data.userData.is_guest,
			};

			const existingIndex = participants.value.findIndex(
				(p) => p.user_id === newParticipant.user_id,
			);
			if (existingIndex === -1) {
				participants.value.push(newParticipant);
			}
		});

		currentSocket.on("participant_left", (data: ParticipantLeftEvent) => {
			if (data.participantId.startsWith("preview-")) {
				return;
			}
			const index = participants.value.findIndex(
				(p) => p.user_id === data.participantId,
			);
			if (index !== -1) {
				participants.value.splice(index, 1);
			}
		});

		// schedule the first token refresh
		if (tokenData.expires_in) {
			scheduleTokenRefresh(tokenData.expires_in);
		}
	};

	const refresh = (): void => {
		error.value = null;
		fetchPresenceToken.fetch();
	};

	onUnmounted(() => {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
		}

		if (socket) {
			socket.off("participant_joined");
			socket.off("participant_left");
			socket.disconnect();
		}
	});

	return {
		participants: readonly(participants),
		error: readonly(error),
		refresh,
		topParticipants: computed(() => participants.value.slice(0, 3)),
		extraCount: computed(() => Math.max(0, participants.value.length - 3)),
	};
}
