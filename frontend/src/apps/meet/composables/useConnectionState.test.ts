import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearGuestSession,
	clearRetryableGuestSession,
	readActiveGuestSession,
	readGuestSession,
	setCurrentGuestIdentity,
	shouldAutoConnectAdmittedGuest,
	writeGuestSession,
} from "./useConnectionState";

describe("guest browser session", () => {
	beforeEach(() => sessionStorage.clear());

	it("reuses a complete room-scoped guest session", () => {
		writeGuestSession({
			guestId: "guest_1",
			guestSessionToken: "proof-1",
			meetingId: "room-1",
			guestName: "Guest One",
			status: "pending",
		});

		expect(readGuestSession("room-1")).toEqual({
			guestId: "guest_1",
			guestSessionToken: "proof-1",
			meetingId: "room-1",
			guestName: "Guest One",
			status: "pending",
		});
	});

	it("does not disclose a session to another room", () => {
		writeGuestSession({
			guestId: "guest_1",
			guestSessionToken: "proof-1",
			meetingId: "room-1",
			guestName: "Guest One",
			status: "admitted",
		});

		expect(readGuestSession("room-2")).toBeNull();
	});

	it("never returns terminal proof as an active guest session", () => {
		writeGuestSession({
			guestId: "guest_1",
			guestSessionToken: "proof-1",
			meetingId: "room-1",
			guestName: "Guest One",
			status: "expired",
		});

		expect(readActiveGuestSession("room-1")).toBeNull();
	});

	it("returns admitted proof for an explicit preview Join", () => {
		writeGuestSession({
			guestId: "guest_1",
			guestSessionToken: "proof-1",
			meetingId: "room-1",
			guestName: "Guest One",
			status: "admitted",
		});

		expect(readActiveGuestSession("room-1")).toMatchObject({
			guestId: "guest_1",
			guestSessionToken: "proof-1",
			status: "admitted",
		});
	});

	it.each(["pending", "admitted", "rejected", "banned", "expired"] as const)(
		"preserves %s status across reload",
		(status) => {
			writeGuestSession({
				guestId: "guest_1",
				guestSessionToken: "proof-1",
				meetingId: "room-1",
				guestName: "Guest One",
				status,
			});
			expect(readGuestSession("room-1")?.status).toBe(status);
		},
	);

	it("clears proof only on an explicit clear", () => {
		writeGuestSession({
			guestId: "guest_1",
			guestSessionToken: "proof-1",
			meetingId: "room-1",
			guestName: "Guest One",
			status: "admitted",
		});

		clearGuestSession();

		expect(readGuestSession("room-1")).toBeNull();
	});

	it("restores the stored guest identity before automatic connection setup", () => {
		const setCurrentUser = vi.fn();
		setCurrentGuestIdentity(
			{ setCurrentUser },
			{
				guestId: "guest_reload",
				guestSessionToken: "proof-1",
				meetingId: "room-1",
				guestName: "Reloaded Guest",
				status: "admitted",
			},
		);

		expect(setCurrentUser).toHaveBeenCalledWith({
			user_id: "guest_reload",
			userId: "guest_reload",
			name: "Reloaded Guest",
			full_name: "Reloaded Guest",
			is_guest: true,
		});
	});

	it.each(["rejected", "expired"] as const)(
		"clears a %s session only through explicit retry",
		(status) => {
			writeGuestSession({
				guestId: "guest_1",
				guestSessionToken: "proof-1",
				meetingId: "room-1",
				guestName: "Guest One",
				status,
			});

			expect(clearRetryableGuestSession("room-1")).toBe(true);
			expect(readGuestSession("room-1")).toBeNull();
		},
	);

	it("does not clear a banned tombstone for retry", () => {
		writeGuestSession({
			guestId: "guest_1",
			guestSessionToken: "proof-1",
			meetingId: "room-1",
			guestName: "Guest One",
			status: "banned",
		});

		expect(clearRetryableGuestSession("room-1")).toBe(false);
		expect(readGuestSession("room-1")?.status).toBe("banned");
	});

	it("auto-connects only when admission completes a pending join request", () => {
		const admittedSession = {
			guestId: "guest_1",
			guestSessionToken: "proof-1",
			meetingId: "room-1",
			guestName: "Guest One",
			status: "admitted" as const,
		};

		expect(
			shouldAutoConnectAdmittedGuest({
				...admittedSession,
				status: "pending",
			}),
		).toBe(true);
		expect(shouldAutoConnectAdmittedGuest(admittedSession)).toBe(false);
	});
});
