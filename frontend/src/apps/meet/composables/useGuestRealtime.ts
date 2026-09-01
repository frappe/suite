import { frappeRequest } from "frappe-ui";
import type { Socket } from "socket.io-client";
import {
	isUnknownRecord,
	type JoinPayload,
	normalizeJoinPayload,
} from "../types";
import type {
	GuestSessionStatus,
	StoredGuestSession,
} from "./useConnectionState";

type ActiveGuestSessionStatus = Extract<
	GuestSessionStatus,
	"pending" | "admitted"
>;
type TerminalGuestSessionStatus = Exclude<
	GuestSessionStatus,
	ActiveGuestSessionStatus
>;

interface GuestRealtimeEvent {
	guestId: string;
	meetingId: string;
}

const GUEST_SUBSCRIPTION_RETRY_DELAY = 5_000;
const GUEST_SUBSCRIPTION_MAX_RETRIES = 4;

interface GuestRealtimeLifecycleOptions {
	socket: Socket | null;
	meetingId: string;
	readSession: () => StoredGuestSession | null;
	onActiveStatus: (
		status: ActiveGuestSessionStatus,
		session: StoredGuestSession,
	) => void | Promise<void>;
	onTerminalStatus: (status: TerminalGuestSessionStatus) => void;
	onError: (error: Error) => void;
}

function isActiveSession(
	session: StoredGuestSession | null,
): session is StoredGuestSession & { status: ActiveGuestSessionStatus } {
	return session?.status === "pending" || session?.status === "admitted";
}

function normalizeGuestRealtimeEvent(value: unknown): GuestRealtimeEvent | null {
	if (
		!isUnknownRecord(value) ||
		typeof value.guest_id !== "string" ||
		typeof value.meeting_id !== "string"
	) return null;
	return { guestId: value.guest_id, meetingId: value.meeting_id };
}

function normalizeStatus(
	value: unknown,
): ActiveGuestSessionStatus | TerminalGuestSessionStatus | null {
	return value === "pending" ||
		value === "admitted" ||
		value === "rejected" ||
		value === "banned" ||
		value === "expired"
		? value
		: null;
}

export async function getApprovedGuestConnectionDetails(
	session: StoredGuestSession,
): Promise<JoinPayload> {
	const response = normalizeJoinPayload(
		await frappeRequest({
			url: "suite.meet.api.meeting.get_approved_guest_connection_details",
			method: "POST",
			params: {
				meeting_id: session.meetingId,
				guest_id: session.guestId,
				guest_session_token: session.guestSessionToken,
			},
		}),
	);
	if (response?.status !== "joined" || !response.auth_token) {
		throw new Error("Guest is not admitted to this meeting");
	}
	if (response.guest_id && response.guest_id !== session.guestId) {
		throw new Error("Approved guest identity does not match the stored session");
	}
	return response;
}

export function createGuestRealtimeLifecycle({
	socket,
	meetingId,
	readSession,
	onActiveStatus,
	onTerminalStatus,
	onError,
}: GuestRealtimeLifecycleOptions) {
	let setup = false;
	let subscribedSession: StoredGuestSession | null = null;
	let subscriptionRetryTimeout: ReturnType<typeof setTimeout> | null = null;
	let subscriptionRetryCount = 0;

	const matchesSubscribedSession = (value: unknown) => {
		const event = normalizeGuestRealtimeEvent(value);
		return Boolean(
			subscribedSession &&
				event?.guestId === subscribedSession.guestId &&
				event.meetingId === meetingId,
		);
	};

	const unsubscribe = () => {
		if (!socket || !subscribedSession) return;
		socket.emit("guest_unsubscribe", {
			guest_id: subscribedSession.guestId,
			meeting_id: meetingId,
			guest_session_token: subscribedSession.guestSessionToken,
		});
		subscribedSession = null;
	};

	const stop = () => {
		unsubscribe();
		if (subscriptionRetryTimeout) {
			clearTimeout(subscriptionRetryTimeout);
			subscriptionRetryTimeout = null;
		}
		subscriptionRetryCount = 0;
		if (!socket || !setup) return;
		socket.off("meet:guest_join_approved", handleApproved);
		socket.off("meet:guest_join_rejected", handleRejected);
		socket.off("connect", handleReconnect);
		setup = false;
	};

	const handleTerminalStatus = (status: TerminalGuestSessionStatus) => {
		onTerminalStatus(status);
		stop();
	};

	const handleAcknowledgement = (value: unknown) => {
		if (!isUnknownRecord(value) || typeof value.ok !== "boolean") {
			onError(new Error("Invalid guest subscription acknowledgement"));
			return;
		}
		const status = normalizeStatus(value.status);
		if (value.ok) {
			subscriptionRetryCount = 0;
			if (!status || status === "rejected" || status === "banned" || status === "expired") {
				onError(new Error("Invalid guest subscription status"));
				return;
			}
			if (subscribedSession) void onActiveStatus(status, subscribedSession);
			return;
		}
		if (status === "rejected" || status === "banned" || status === "expired") {
			handleTerminalStatus(status);
			return;
		}
		const reason = typeof value.error === "string" ? value.error : "invalid_request";
		if (reason === "validation_failed") {
			if (subscriptionRetryCount >= GUEST_SUBSCRIPTION_MAX_RETRIES) {
				onError(new Error("Could not verify your guest session. Please reconnect."));
				return;
			}
			if (!subscriptionRetryTimeout) {
				const delay = GUEST_SUBSCRIPTION_RETRY_DELAY * 2 ** subscriptionRetryCount;
				subscriptionRetryCount += 1;
				subscriptionRetryTimeout = setTimeout(() => {
					subscriptionRetryTimeout = null;
					subscribe();
				}, delay);
			}
			return;
		}
		onError(new Error(`Guest realtime subscription failed: ${reason}`));
	};

	const subscribe = () => {
		const session = readSession();
		if (!socket || !isActiveSession(session)) return;
		if (subscriptionRetryTimeout) {
			clearTimeout(subscriptionRetryTimeout);
			subscriptionRetryTimeout = null;
		}
		if (
			subscribedSession &&
			(subscribedSession.guestId !== session.guestId ||
				subscribedSession.guestSessionToken !== session.guestSessionToken)
		) unsubscribe();
		subscribedSession = { ...session };
		socket.emit(
			"guest_subscribe",
			{
				guest_id: session.guestId,
				meeting_id: meetingId,
				guest_session_token: session.guestSessionToken,
			},
			handleAcknowledgement,
		);
	};

	function handleApproved(value: unknown) {
		if (matchesSubscribedSession(value) && subscribedSession) {
			void onActiveStatus("admitted", subscribedSession);
		}
	}
	function handleRejected(value: unknown) {
		if (matchesSubscribedSession(value)) handleTerminalStatus("rejected");
	}
	function handleReconnect() {
		subscriptionRetryCount = 0;
		subscribe();
	}

	const start = () => {
		const session = readSession();
		if (!socket || !isActiveSession(session)) return;
		if (
			setup &&
			subscribedSession?.guestId === session.guestId &&
			subscribedSession.guestSessionToken === session.guestSessionToken
		) return;
		if (!setup) {
			socket.on("meet:guest_join_approved", handleApproved);
			socket.on("meet:guest_join_rejected", handleRejected);
			socket.on("connect", handleReconnect);
			setup = true;
		}
		subscribe();
	};

	return { start, stop };
}
