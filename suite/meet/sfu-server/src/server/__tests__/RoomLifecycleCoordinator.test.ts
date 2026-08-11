import type { Socket } from 'socket.io';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediasoupManager } from '../../mediasoup/MediasoupManager';
import type { E2EEEpochRelay } from '../E2EEEpochRelay';
import type { E2eeRosterStore } from '../E2eeRosterStore';
import { RoomLifecycleCoordinator } from '../RoomLifecycleCoordinator';
import type { RoomRegistry } from '../RoomRegistry';

function createCoordinator(graceMs = 1_000) {
	const recorder = { disconnect: vi.fn() } as unknown as Socket;
	const registry = {
		hasHumanParticipants: vi.fn().mockReturnValue(false),
		getRecorderSockets: vi.fn().mockReturnValue([recorder]),
		cleanupMediaRoom: vi.fn(),
	};
	const epochRelay = { clearRoom: vi.fn() };
	const roster = { clearRoom: vi.fn().mockResolvedValue(undefined) };
	const mediasoup = { closeRoom: vi.fn().mockResolvedValue(undefined) };
	const coordinator = new RoomLifecycleCoordinator(
		registry as unknown as RoomRegistry,
		epochRelay as unknown as E2EEEpochRelay,
		roster as unknown as E2eeRosterStore,
		mediasoup as unknown as MediasoupManager,
		graceMs,
	);
	return { coordinator, epochRelay, mediasoup, recorder, registry, roster };
}

afterEach(() => {
	vi.useRealTimers();
});

describe('RoomLifecycleCoordinator', () => {
	it('cleans human-empty room state and disconnects recorders after grace', async () => {
		vi.useFakeTimers();
		const fixture = createCoordinator();

		fixture.coordinator.scheduleCleanupIfHumanEmpty('room-1');
		await vi.advanceTimersByTimeAsync(999);
		expect(fixture.mediasoup.closeRoom).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(fixture.recorder.disconnect).toHaveBeenCalledWith(true);
		expect(fixture.registry.cleanupMediaRoom).toHaveBeenCalledWith('room-1');
		expect(fixture.epochRelay.clearRoom).toHaveBeenCalledWith('room-1');
		expect(fixture.roster.clearRoom).toHaveBeenCalledWith('room-1');
		expect(fixture.mediasoup.closeRoom).toHaveBeenCalledWith('room-1');
	});

	it('cancels pending cleanup when a human joins', async () => {
		vi.useFakeTimers();
		const fixture = createCoordinator();

		fixture.coordinator.scheduleCleanupIfHumanEmpty('room-1');
		await fixture.coordinator.humanJoined('room-1');
		await vi.advanceTimersByTimeAsync(1_000);

		expect(fixture.mediasoup.closeRoom).not.toHaveBeenCalled();
	});

	it('rechecks occupancy when grace expires', async () => {
		vi.useFakeTimers();
		const fixture = createCoordinator();
		fixture.coordinator.scheduleCleanupIfHumanEmpty('room-1');
		fixture.registry.hasHumanParticipants.mockReturnValue(true);

		await vi.advanceTimersByTimeAsync(1_000);

		expect(fixture.mediasoup.closeRoom).not.toHaveBeenCalled();
	});

	it('waits for in-flight cleanup before allowing a human join to continue', async () => {
		vi.useFakeTimers();
		const fixture = createCoordinator();
		let finishCleanup: (() => void) | undefined;
		fixture.mediasoup.closeRoom.mockReturnValue(
			new Promise<void>((resolve) => {
				finishCleanup = resolve;
			}),
		);
		fixture.coordinator.scheduleCleanupIfHumanEmpty('room-1');
		await vi.advanceTimersByTimeAsync(1_000);

		let joined = false;
		const join = fixture.coordinator.humanJoined('room-1').then(() => {
			joined = true;
		});
		await Promise.resolve();
		expect(joined).toBe(false);

		finishCleanup?.();
		await join;
		expect(joined).toBe(true);
	});

	it('clears pending timers on stop', async () => {
		vi.useFakeTimers();
		const fixture = createCoordinator();
		fixture.coordinator.scheduleCleanupIfHumanEmpty('room-1');

		fixture.coordinator.stop();
		await vi.advanceTimersByTimeAsync(1_000);

		expect(fixture.mediasoup.closeRoom).not.toHaveBeenCalled();
	});
});
