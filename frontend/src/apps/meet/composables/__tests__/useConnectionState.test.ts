import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useConnectionState } from "../useConnectionState";

describe("useConnectionState recovery timeline", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it("keeps the latest 40 recovery transitions", () => {
		const connectionState = useConnectionState();

		for (let index = 0; index < 41; index++) {
			connectionState.setRecoveryState("reconnecting", `attempt-${index}`);
		}

		expect(connectionState.recoveryState).toBe("reconnecting");
		expect(connectionState.recoveryTimeline).toHaveLength(40);
		expect(connectionState.recoveryTimeline[0].detail).toBe("attempt-1");
		expect(connectionState.recoveryTimeline[39].detail).toBe("attempt-40");
	});

	it("clears recovery state with the rest of the connection state", () => {
		const connectionState = useConnectionState();
		connectionState.setRecoveryState("failed", "session rebuild failed");

		connectionState.$reset();

		expect(connectionState.recoveryState).toBe("healthy");
		expect(connectionState.recoveryTimeline).toEqual([]);
	});
});
