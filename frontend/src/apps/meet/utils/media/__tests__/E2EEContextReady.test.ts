import { afterEach, describe, expect, it, vi } from "vitest";
import { useE2EEState } from "../../../composables/useE2EEState";
import {
	notifyE2EEContextReady,
	resetE2EEContextReady,
} from "../E2EEContextReady";
import { E2EEMeeting } from "../E2EEMeeting";

describe("E2EEContextReady", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		resetE2EEContextReady();
	});

	it("ignores fingerprint completion after readiness is reset", async () => {
		let resolveFingerprint!: (fingerprint: string) => void;
		const fingerprint = new Promise<string>((resolve) => {
			resolveFingerprint = resolve;
		});
		vi.spyOn(E2EEMeeting.instance, "getSessionFingerprint").mockReturnValue(
			fingerprint,
		);

		notifyE2EEContextReady();
		resetE2EEContextReady();
		resolveFingerprint("stale fingerprint");
		await fingerprint;
		await Promise.resolve();

		expect(useE2EEState().isContextReady.value).toBe(false);
		expect(useE2EEState().sessionFingerprint.value).toBeNull();
	});

	it("keeps the newest fingerprint when rekeys complete out of order", async () => {
		let resolveFirst!: (fingerprint: string) => void;
		let resolveSecond!: (fingerprint: string) => void;
		const first = new Promise<string>((resolve) => {
			resolveFirst = resolve;
		});
		const second = new Promise<string>((resolve) => {
			resolveSecond = resolve;
		});
		vi.spyOn(E2EEMeeting.instance, "getSessionFingerprint")
			.mockReturnValueOnce(first)
			.mockReturnValueOnce(second);

		notifyE2EEContextReady();
		notifyE2EEContextReady();
		resolveSecond("new fingerprint");
		await second;
		await Promise.resolve();
		resolveFirst("stale fingerprint");
		await first;
		await Promise.resolve();

		expect(useE2EEState().sessionFingerprint.value).toBe("new fingerprint");
	});
});
