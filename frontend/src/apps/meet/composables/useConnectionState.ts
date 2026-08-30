import { defineStore } from "pinia";
import { ref } from "vue";
import type { CurrentUser } from "./useCurrentUser";

export type GuestSessionStatus =
	| "pending"
	| "admitted"
	| "rejected"
	| "banned"
	| "expired";

export interface StoredGuestSession {
	guestId: string;
	guestSessionToken: string;
	meetingId: string;
	guestName: string;
	status: GuestSessionStatus;
}

const GUEST_SESSION_KEYS = {
	guestId: "guest_id",
	guestSessionToken: "guest_session_token",
	meetingId: "guest_meeting_id",
	guestName: "guest_name",
	status: "guest_status",
} as const;

export function readGuestSession(meetingId: string): StoredGuestSession | null {
	const guestId = sessionStorage.getItem(GUEST_SESSION_KEYS.guestId);
	const guestSessionToken = sessionStorage.getItem(
		GUEST_SESSION_KEYS.guestSessionToken,
	);
	const storedMeetingId = sessionStorage.getItem(GUEST_SESSION_KEYS.meetingId);
	const guestName = sessionStorage.getItem(GUEST_SESSION_KEYS.guestName);
	const status = sessionStorage.getItem(GUEST_SESSION_KEYS.status);
	if (
		!guestId ||
		!guestSessionToken ||
		storedMeetingId !== meetingId ||
		!guestName ||
		!status ||
		!["pending", "admitted", "rejected", "banned", "expired"].includes(status)
	) {
		return null;
	}
	return {
		guestId,
		guestSessionToken,
		meetingId: storedMeetingId,
		guestName,
		status: status as GuestSessionStatus,
	};
}

export function readActiveGuestSession(
	meetingId: string,
): StoredGuestSession | null {
	const session = readGuestSession(meetingId);
	return session?.status === "pending" || session?.status === "admitted"
		? session
		: null;
}

export function writeGuestSession(session: StoredGuestSession): void {
	sessionStorage.setItem(GUEST_SESSION_KEYS.guestId, session.guestId);
	sessionStorage.setItem(
		GUEST_SESSION_KEYS.guestSessionToken,
		session.guestSessionToken,
	);
	sessionStorage.setItem(GUEST_SESSION_KEYS.meetingId, session.meetingId);
	sessionStorage.setItem(GUEST_SESSION_KEYS.guestName, session.guestName);
	sessionStorage.setItem(GUEST_SESSION_KEYS.status, session.status);
}

export function clearGuestSession(): void {
	for (const key of Object.values(GUEST_SESSION_KEYS)) {
		sessionStorage.removeItem(key);
	}
}

export function clearRetryableGuestSession(meetingId: string): boolean {
	const session = readGuestSession(meetingId);
	if (session?.status !== "rejected" && session?.status !== "expired") {
		return false;
	}
	clearGuestSession();
	return true;
}

export function clearGuestSessionForExit(meetingId: string): void {
	if (readGuestSession(meetingId)?.status !== "banned") clearGuestSession();
}

export function setCurrentGuestIdentity(
	currentUser: Pick<CurrentUser, "setCurrentUser">,
	guestSession: StoredGuestSession,
): void {
	currentUser.setCurrentUser({
		user_id: guestSession.guestId,
		userId: guestSession.guestId,
		name: guestSession.guestName,
		full_name: guestSession.guestName,
		is_guest: true,
	});
}

export function shouldAutoConnectAdmittedGuest(
	subscribedSession: StoredGuestSession,
): boolean {
	return subscribedSession.status === "pending";
}

export interface ConnectionState {
	connectionError: string | null;
	connectionMoved: boolean;
	isInPreview: boolean;
	codecStrategy: string;
	networkQuality: string;
	connectionIssues: string[];
	guestId: string | null;
	guestAuthToken: string | null;
	guestSfuUrl: string | null;
	guestSfuPort: string | null;
	guestSessionToken: string | null;
	justCreated: boolean;
	$reset: () => void;
}

export const useConnectionState = defineStore("meet-connection", () => {
	const connectionError = ref<string | null>(null);
	const connectionMoved = ref(false);
	const isInPreview = ref(true);
	const codecStrategy = ref("svc");
	const networkQuality = ref("good");
	const connectionIssues = ref<string[]>([]);
	const guestId = ref<string | null>(null);
	const guestAuthToken = ref<string | null>(null);
	const guestSfuUrl = ref<string | null>(null);
	const guestSfuPort = ref<string | null>(null);
	const guestSessionToken = ref<string | null>(null);
	const justCreated = ref(false);

	function $reset() {
		connectionError.value = null;
		connectionMoved.value = false;
		isInPreview.value = true;
		codecStrategy.value = "svc";
		networkQuality.value = "good";
		connectionIssues.value = [];
		guestId.value = null;
		guestAuthToken.value = null;
		guestSfuUrl.value = null;
		guestSfuPort.value = null;
		guestSessionToken.value = null;
		justCreated.value = false;
	}

	return {
		connectionError,
		connectionMoved,
		isInPreview,
		codecStrategy,
		networkQuality,
		connectionIssues,
		guestId,
		guestAuthToken,
		guestSfuUrl,
		guestSfuPort,
		guestSessionToken,
		justCreated,
		$reset,
	};
});
