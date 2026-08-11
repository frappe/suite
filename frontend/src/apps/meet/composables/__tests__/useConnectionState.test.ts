import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useConnectionState } from "../useConnectionState";

describe("useConnectionState", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it("resets preview, guest connection details, and page errors", () => {
		const connectionState = useConnectionState();
		connectionState.connectionError = "failed";
		connectionState.isInPreview = false;
		connectionState.guestAuthToken = "token";

		connectionState.$reset();

		expect(connectionState.connectionError).toBeNull();
		expect(connectionState.isInPreview).toBe(true);
		expect(connectionState.guestAuthToken).toBeNull();
	});
});
