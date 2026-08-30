import { frappeRequest } from "frappe-ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io-client";
import {
	createGuestRealtimeLifecycle,
	getApprovedGuestConnectionDetails,
} from "./useGuestRealtime";

vi.mock("frappe-ui", () => ({ frappeRequest: vi.fn() }));

const session = {
	guestId: "guest_private",
	guestSessionToken: "private-proof",
	meetingId: "room-1",
	guestName: "Guest One",
	status: "pending" as const,
};

function createSocket() {
	const listeners = new Map<string, (...args: unknown[]) => void>();
	const emit = vi.fn();
	return {
		listeners,
		socket: {
			on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
				listeners.set(event, listener);
			}),
			off: vi.fn((event: string) => listeners.delete(event)),
			emit,
		} as unknown as Socket,
		emit,
	};
}

function createLifecycle(
	socket: Socket,
	readSession = () => session,
	callbacks = {
		onActiveStatus: vi.fn(),
		onTerminalStatus: vi.fn(),
		onError: vi.fn(),
	},
) {
	return {
		callbacks,
		lifecycle: createGuestRealtimeLifecycle({
			socket,
			meetingId: "room-1",
			readSession,
			...callbacks,
		}),
	};
}

describe("guest realtime lifecycle", () => {
	beforeEach(() => vi.clearAllMocks());

	it("fetches admitted credentials through the POST-only proof-bound endpoint", async () => {
		vi.mocked(frappeRequest).mockResolvedValue({
			status: "joined",
			guest_id: "guest_private",
			auth_token: "guest-jwt",
		});

		await getApprovedGuestConnectionDetails(session);

		expect(frappeRequest).toHaveBeenCalledWith({
			url: "suite.meet.api.meeting.get_approved_guest_connection_details",
			method: "POST",
			params: {
				meeting_id: "room-1",
				guest_id: "guest_private",
				guest_session_token: "private-proof",
			},
		});
	});

	it.each(["pending", "admitted"] as const)(
		"subscribes a stored %s guest with private proof and resubscribes on reconnect",
		(status) => {
			const { socket, emit, listeners } = createSocket();
			const { lifecycle } = createLifecycle(socket, () => ({ ...session, status }));

			lifecycle.start();
			listeners.get("connect")?.();

			expect(emit).toHaveBeenNthCalledWith(
				1,
				"guest_subscribe",
				{
					guest_id: "guest_private",
					meeting_id: "room-1",
					guest_session_token: "private-proof",
				},
				expect.any(Function),
			);
			expect(emit).toHaveBeenCalledTimes(2);
		},
	);

	it.each([
		["pending", true],
		["admitted", false],
	] as const)(
		"preserves prior %s state when an admitted acknowledgement arrives",
		(priorStatus, wasPending) => {
			const { socket, emit } = createSocket();
			const { lifecycle, callbacks } = createLifecycle(socket, () => ({
				...session,
				status: priorStatus,
			}));
			lifecycle.start();

			const acknowledge = emit.mock.calls[0][2] as (response: unknown) => void;
			acknowledge({ ok: true, status: "admitted" });

			expect(callbacks.onActiveStatus).toHaveBeenCalledWith(
				"admitted",
				expect.objectContaining({ status: wasPending ? "pending" : "admitted" }),
			);
		},
	);

	it("does not duplicate listeners or subscription when start is repeated", () => {
		const { socket, emit } = createSocket();
		const { lifecycle } = createLifecycle(socket);

		lifecycle.start();
		lifecycle.start();

		expect(socket.on).toHaveBeenCalledTimes(3);
		expect(emit).toHaveBeenCalledTimes(1);
	});

	it.each(["pending", "admitted"] as const)(
		"uses active %s status from the acknowledgement without an API request",
		(status) => {
			const { socket, emit } = createSocket();
			const { lifecycle, callbacks } = createLifecycle(socket);
			lifecycle.start();

			const acknowledge = emit.mock.calls[0][2] as (response: unknown) => void;
			acknowledge({ ok: true, status });

			expect(callbacks.onActiveStatus).toHaveBeenCalledWith(status, session);
			expect(callbacks.onTerminalStatus).not.toHaveBeenCalled();
		},
	);

	it.each(["rejected", "banned", "expired"] as const)(
		"handles terminal %s status and unsubscribes",
		(status) => {
			const { socket, emit } = createSocket();
			const { lifecycle, callbacks } = createLifecycle(socket);
			lifecycle.start();

			const acknowledge = emit.mock.calls[0][2] as (response: unknown) => void;
			acknowledge({ ok: false, error: "unauthorized", status });

			expect(callbacks.onTerminalStatus).toHaveBeenCalledWith(status);
			expect(emit).toHaveBeenLastCalledWith("guest_unsubscribe", {
				guest_id: "guest_private",
				meeting_id: "room-1",
				guest_session_token: "private-proof",
			});
		},
	);

	it("reconciles a terminal status over HTTP when its realtime event is missed", async () => {
		vi.useFakeTimers();
		try {
			vi.mocked(frappeRequest).mockResolvedValue({
				valid: false,
				status: "rejected",
			});
			const { socket } = createSocket();
			const { lifecycle, callbacks } = createLifecycle(socket);
			lifecycle.start();

			await vi.advanceTimersByTimeAsync(5_000);

			expect(callbacks.onTerminalStatus).toHaveBeenCalledWith("rejected");
			expect(frappeRequest).toHaveBeenCalledWith({
				url: "suite.meet.api.meeting.validate_guest_session",
				method: "POST",
				params: {
					meeting_id: "room-1",
					guest_id: "guest_private",
					guest_session_token: "private-proof",
				},
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("expires a stored guest when reconciliation can no longer find its lease", async () => {
		vi.useFakeTimers();
		try {
			vi.mocked(frappeRequest).mockResolvedValue({ valid: false });
			const { socket } = createSocket();
			const { lifecycle, callbacks } = createLifecycle(socket);
			lifecycle.start();

			await vi.advanceTimersByTimeAsync(5_000);

			expect(callbacks.onTerminalStatus).toHaveBeenCalledWith("expired");
		} finally {
			vi.useRealTimers();
		}
	});

	it.each(["invalid_request", "validation_failed"])(
		"surfaces %s acknowledgement failures",
		(error) => {
			const { socket, emit } = createSocket();
			const { lifecycle, callbacks } = createLifecycle(socket);
			lifecycle.start();

			const acknowledge = emit.mock.calls[0][2] as (response: unknown) => void;
			acknowledge({ ok: false, error });

			expect(callbacks.onError).toHaveBeenCalledWith(
				expect.objectContaining({ message: expect.stringContaining(error) }),
			);
		},
	);

	it("fetches admitted details through the active-status callback after approval", () => {
		const { socket, listeners } = createSocket();
		const { lifecycle, callbacks } = createLifecycle(socket);
		lifecycle.start();

		listeners.get("meet:guest_join_approved")?.({
			guest_id: "guest_private",
			meeting_id: "room-1",
		});

		expect(callbacks.onActiveStatus).toHaveBeenCalledWith("admitted", session);
	});

	it("uses the cached session to unsubscribe after storage is cleared", () => {
		const { socket, emit } = createSocket();
		let storedSession: typeof session | null = session;
		const { lifecycle } = createLifecycle(socket, () => storedSession);
		lifecycle.start();
		storedSession = null;

		lifecycle.stop();

		expect(emit).toHaveBeenLastCalledWith("guest_unsubscribe", {
			guest_id: "guest_private",
			meeting_id: "room-1",
			guest_session_token: "private-proof",
		});
		expect(socket.off).toHaveBeenCalledTimes(3);
	});

	it.each(["rejected", "banned", "expired"] as const)(
		"does not subscribe a terminal %s session",
		(status) => {
			const { socket, emit } = createSocket();
			const { lifecycle } = createLifecycle(socket, () => ({ ...session, status }));

			lifecycle.start();

			expect(emit).not.toHaveBeenCalled();
		},
	);
});
