import { describe, expect, it } from "vitest";
import { firstCaptureStartedAt } from "./recordingClock";

describe("firstCaptureStartedAt", () => {
	it("keeps the Recording Session start across recovery epochs", () => {
		const initial = firstCaptureStartedAt(null, "2026-08-30T12:00:01.000Z");
		expect(
			firstCaptureStartedAt(initial, "2026-08-30T12:01:01.000Z"),
		).toBe(initial);
	});
});
