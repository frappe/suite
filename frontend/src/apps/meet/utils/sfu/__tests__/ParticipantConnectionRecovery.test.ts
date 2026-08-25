import { describe, expect, it, vi } from "vitest";
import { ParticipantConnectionRecovery } from "../ParticipantConnectionRecovery";

const trigger = { scope: "transport" as const, reason: "restart_failed" };

describe("ParticipantConnectionRecovery", () => {
	it("shares one recovery and verifies it before becoming healthy", async () => {
		const rebuild = vi.fn().mockResolvedValue(undefined);
		const verify = vi.fn().mockResolvedValue(undefined);
		const onTransition = vi.fn();
		const recovery = new ParticipantConnectionRecovery({
			rebuild,
			verify,
			onTransition,
		});
		const signal = new AbortController().signal;

		const first = recovery.recover(trigger, signal);
		const duplicate = recovery.recover(
			{ scope: "subscription", reason: "retry_limit" },
			signal,
		);

		expect(duplicate).toBe(first);
		await expect(first).resolves.toBe(true);
		expect(rebuild).toHaveBeenCalledOnce();
		expect(verify).toHaveBeenCalledOnce();
		expect(onTransition.mock.calls.map(([event]) => event.phase)).toEqual([
			"rebuilding_participant_connection",
			"verifying",
			"healthy",
		]);
	});

	it("uses bounded full-jitter backoff and enters terminal failure", async () => {
		const sleep = vi.fn().mockResolvedValue(undefined);
		const onTransition = vi.fn();
		const recovery = new ParticipantConnectionRecovery({
			rebuild: vi.fn().mockRejectedValue(new Error("failed")),
			verify: vi.fn(),
			random: () => 0.5,
			sleep,
			onTransition,
		});

		await expect(
			recovery.recover(trigger, new AbortController().signal),
		).resolves.toBe(false);

		expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([500, 1000]);
		expect(onTransition).toHaveBeenLastCalledWith(
			expect.objectContaining({
				phase: "terminal_failed",
				attempt: 3,
				maxAttempts: 3,
			}),
		);
	});

	it("stops retrying when its Participant Connection generation is aborted", async () => {
		const controller = new AbortController();
		const sleep = vi.fn((_delay, signal: AbortSignal) => {
			controller.abort(new DOMException("stopped", "AbortError"));
			return Promise.reject(signal.reason);
		});
		const recovery = new ParticipantConnectionRecovery({
			rebuild: vi.fn().mockRejectedValue(new Error("failed")),
			verify: vi.fn(),
			sleep,
		});

		await expect(recovery.recover(trigger, controller.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
	});
});
