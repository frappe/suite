import { defineStore } from "pinia";
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

export const useConnectionState = defineStore("meet-connection", {
	state: () => ({
		connectionError: null as string | null,
		connectionMoved: false,
		isInPreview: true,
		codecStrategy: "svc",
		networkQuality: "good",
		guestId: null as string | null,
		guestAuthToken: null as string | null,
		guestSessionToken: null as string | null,
		justCreated: false,
	}),
});

export type ConnectionState = ReturnType<typeof useConnectionState>;
