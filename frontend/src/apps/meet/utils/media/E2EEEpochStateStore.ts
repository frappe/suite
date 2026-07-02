import type { ClientState } from "ts-mls";

type ActiveEpochState = {
	epochNumber: number;
	state: ClientState;
	meetingSecret: Uint8Array<ArrayBuffer>;
};

let activeState: ActiveEpochState | null = null;

export function installActiveEpochState(state: ActiveEpochState): void {
	activeState?.meetingSecret.fill(0);
	activeState = state;
}

export function getActiveEpochState(): ActiveEpochState | null {
	return activeState;
}

export function wipeActiveEpochState(): void {
	activeState?.meetingSecret.fill(0);
	activeState = null;
}
