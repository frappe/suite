import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useParticipantConnectionState } from "../useParticipantConnectionState";

describe("useParticipantConnectionState", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it("reports UI setup complete only after lifecycle startup settles", () => {
		const state = useParticipantConnectionState();

		state.setLifecycleState("starting");
		expect(state.isConnecting).toBe(true);
		expect(state.isSetupComplete).toBe(false);

		state.setLifecycleState("syncing");
		expect(state.isConnecting).toBe(true);
		expect(state.isSetupComplete).toBe(false);

		state.setLifecycleState("ready");
		expect(state.isConnecting).toBe(false);
		expect(state.isSetupComplete).toBe(true);
	});

	it("treats degraded as operational", () => {
		const state = useParticipantConnectionState();
		state.setLifecycleState("degraded");

		expect(state.isSetupComplete).toBe(true);
	});

	it("resets lifecycle state and recovery diagnostics", () => {
		const state = useParticipantConnectionState();
		state.setLifecycleState("ready");
		state.recordRecovery("reconnecting", "socket closed");

		state.$reset();

		expect(state.lifecycleState).toBe("stopped");
		expect(state.isSetupComplete).toBe(false);
		expect(state.recoveryTimeline).toEqual([]);
	});
});
