import { describe, expect, it, vi } from 'vitest';
import { createManager } from '../../__tests__/test-helpers';
import type { RoomRegistry } from '../../RoomRegistry';

function getRegistry(harness: ReturnType<typeof createManager>): RoomRegistry {
	return (
		harness.manager as unknown as {
			registry: RoomRegistry;
		}
	).registry;
}

describe('RoomQueryHandlers recorder projection snapshot', () => {
	it('rejects a recorder before it joins the room', () => {
		const harness = createManager();
		const socket = harness.createSocket({
			id: 'recorder-socket',
			scope: 'recording',
			userId: 'recorder:recording-1',
			recordingProofComplete: true,
			recordingClaims: {
				recording_id: 'recording-1',
				recorder_job_id: 'job-1',
			} as never,
		});
		harness.connect(socket);
		getRegistry(harness).activateRecorder(socket, 'recording-1', 'job-1');
		const callback = vi.fn();

		socket.fire('recording:get_projection_snapshot', {}, callback);

		expect(harness.authManager.ensureRecorderAccess).toHaveBeenCalledWith(
			socket,
		);
		expect(callback).toHaveBeenCalledWith({
			success: false,
			error: 'Recorder must join the room first',
		});
	});

	it('returns one retained projection cut to the joined active recorder', async () => {
		const harness = createManager();
		const socket = harness.createSocket({
			id: 'recorder-socket',
			scope: 'recording',
			userId: 'recorder:recording-1',
			recordingProofComplete: true,
			recordingClaims: {
				recording_id: 'recording-1',
				recorder_job_id: 'job-1',
			} as never,
		});
		harness.connect(socket);
		const registry = getRegistry(harness);
		registry.activateRecorder(socket, 'recording-1', 'job-1');
		socket.fire('recording:join', { roomId: 'room-1' }, vi.fn());
		await new Promise((resolve) => setImmediate(resolve));
		registry.emitParticipantEvent('room-1', 'participant_joined', 'p1', {
			name: 'Alice',
			userId: 'account-1',
			audio_enabled: true,
			video_enabled: false,
		});
		const callback = vi.fn();

		socket.fire('recording:get_projection_snapshot', {}, callback);

		expect(callback).toHaveBeenCalledWith({
			success: true,
			snapshot: expect.objectContaining({
				protocol_version: 1,
				room_id: 'room-1',
				cursor: 1,
				participants: [
					{
						participant_id: 'p1',
						name: 'Alice',
						audio_enabled: true,
						video_enabled: false,
					},
				],
			}),
		});
	});
});
