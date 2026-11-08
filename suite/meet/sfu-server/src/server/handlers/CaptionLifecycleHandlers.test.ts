import { fromPartial } from '@total-typescript/shoehorn';
import { describe, expect, it, vi } from 'vitest';
import type { ISttClient } from '../../stt/SttClient';
import { SttManager } from '../../stt/SttManager';
import { registerAuthHandlers } from './AuthHandlers';
import { registerDisconnectHandlers } from './DisconnectHandlers';
import { registerRoomJoinHandlers } from './RoomJoinHandlers';

function createSttManager(): SttManager {
	const sttClient = {
		isAvailable: () => true,
		onAvailable: vi.fn(),
		createStream: vi.fn(),
	} satisfies ISttClient;
	return new SttManager({ sttClient });
}

function captureHandler(eventName: string, id: string) {
	let handler: ((...args: never[]) => unknown) | undefined;
	const socket = {
		id,
		roomId: 'room-1',
		participantId: `participant-${id}`,
		scope: 'full',
		on: (event: string, listener: (...args: never[]) => unknown) => {
			if (event === eventName) handler = listener;
		},
	};
	return { socket, getHandler: () => handler };
}

describe('caption lifecycle cleanup', () => {
	it('keeps captions running until the last subscriber leaves or disconnects', async () => {
		const sttManager = createSttManager();
		sttManager.beginSession('room-1', 'socket-1');
		sttManager.beginSession('room-1', 'socket-2');
		const stopRoom = vi.spyOn(sttManager, 'stopRoom');
		const leaving = captureHandler('leave_room', 'socket-1');
		const disconnecting = captureHandler('disconnect', 'socket-2');
		const leave = vi.fn().mockResolvedValue(undefined);
		const disconnect = vi.fn().mockResolvedValue(undefined);
		registerRoomJoinHandlers(
			fromPartial({
				participantConnections: { leave },
				sttManager,
			}),
		)(fromPartial(leaving.socket));
		registerDisconnectHandlers(
			fromPartial({
				authManager: { cleanupSocket: vi.fn() },
				participantConnections: { disconnect },
				sttManager,
				telemetry: { socketDisconnects: { inc: vi.fn() } },
			}),
		)(fromPartial(disconnecting.socket));

		await leaving.getHandler()?.();

		expect(sttManager.hasSubscribers('room-1')).toBe(true);
		expect(stopRoom).not.toHaveBeenCalled();

		await disconnecting.getHandler()?.(
			fromPartial('client namespace disconnect'),
		);

		expect(sttManager.hasSubscribers('room-1')).toBe(false);
		expect(stopRoom).toHaveBeenCalledOnce();
		expect(stopRoom).toHaveBeenCalledWith('room-1', true);
	});

	it('removes a subscriber only when refreshed auth transitions to E2EE', async () => {
		const sttManager = createSttManager();
		sttManager.beginSession('room-1', 'socket-1');
		const stopRoom = vi.spyOn(sttManager, 'stopRoom');
		const { socket, getHandler } = captureHandler(
			'auth:update_token',
			'socket-1',
		);
		const updateSocketToken = vi.fn(
			(target: typeof socket & { e2eeRequired?: boolean }, token: string) => {
				target.e2eeRequired = token === 'e2ee-token';
			},
		);
		registerAuthHandlers(
			fromPartial({
				authManager: { updateSocketToken },
				sttManager,
				telemetry: { authEvents: { inc: vi.fn() } },
			}),
		)(fromPartial(socket));
		const callback = vi.fn();

		getHandler()?.(
			fromPartial({ token: 'plain-token' }),
			fromPartial(callback),
		);

		expect(callback).toHaveBeenLastCalledWith({ success: true });
		expect(sttManager.hasSubscribers('room-1')).toBe(true);
		expect(stopRoom).not.toHaveBeenCalled();

		getHandler()?.(fromPartial({ token: 'e2ee-token' }), fromPartial(callback));
		await vi.waitFor(() => expect(stopRoom).toHaveBeenCalledOnce());

		expect(callback).toHaveBeenLastCalledWith({ success: true });
		expect(sttManager.hasSubscribers('room-1')).toBe(false);
	});
});
