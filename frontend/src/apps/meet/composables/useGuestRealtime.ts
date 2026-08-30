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

const GUEST_STATUS_RECONCILIATION_INTERVAL = 5_000;

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
	let reconciliationInterval: ReturnType<typeof setInterval> | null = null;
	let reconciliationInProgress = false;

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
		if (reconciliationInterval) {
			clearInterval(reconciliationInterval);
			reconciliationInterval = null;
		}
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
		onError(new Error(`Guest realtime subscription failed: ${reason}`));
	};

	const subscribe = () => {
		const session = readSession();
		if (!socket || !isActiveSession(session)) return;
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

	const reconcile = async () => {
		const session = readSession();
		if (!isActiveSession(session) || reconciliationInProgress) return;
		reconciliationInProgress = true;
		try {
			const response = await frappeRequest({
				url: "suite.meet.api.meeting.validate_guest_session",
				method: "POST",
				params: {
					meeting_id: meetingId,
					guest_id: session.guestId,
					guest_session_token: session.guestSessionToken,
				},
			});
			if (!isUnknownRecord(response)) return;
			const status = normalizeStatus(response.status);
			if (response.valid === true && (status === "pending" || status === "admitted")) {
				await onActiveStatus(status, session);
			} else if (status === "rejected" || status === "banned" || status === "expired") {
				handleTerminalStatus(status);
			} else if (response.valid === false) {
				handleTerminalStatus("expired");
			}
		} catch {
			// Realtime remains the primary path; retry transient reconciliation failures.
		} finally {
			reconciliationInProgress = false;
		}
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
			reconciliationInterval = setInterval(
				() => void reconcile(),
				GUEST_STATUS_RECONCILIATION_INTERVAL,
			);
		}
		subscribe();
	};

	return { start, stop };
}
