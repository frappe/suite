import { describe, expect, it, vi } from 'vitest';
import { registerScreenShareHandlers } from '../ScreenShareHandlers';

function setup() {
	const handlers = new Map<
		string,
		(data: unknown, callback?: (response: unknown) => void) => void
	>();
	const socket = {
		participantId: 'participant-1',
		peerId: 'peer-1',
		roomId: 'room-1',
		userId: 'user-1',
		on: vi.fn((event: string, handler: (data: unknown) => void) => {
			handlers.set(event, handler);
		}),
	};
	const emitScreenShare = vi.fn();
	const assertProducerAccess = vi.fn(() => ({
		producer: { kind: 'video', appData: { type: 'screen' } },
	}));
	const deps = {
		authManager: { ensureFullAccess: vi.fn() },
		mediasoup: { assertProducerAccess },
		registry: { emitScreenShare },
	};
	registerScreenShareHandlers(deps as never)(socket as never);
	return { assertProducerAccess, emitScreenShare, handlers };
}

describe('ScreenShareHandlers', () => {
	it('broadcasts screen stop with producer identity and no consumer identity', () => {
		const { emitScreenShare, handlers } = setup();
		const callback = vi.fn();

		handlers.get('screen_share')?.(
			{
				action: 'stop_share',
				shareData: {
					producerId: 'producer-1',
					consumerId: 'browser-only-consumer',
					reason: 'user-click',
				},
			},
			callback,
		);

		expect(emitScreenShare).toHaveBeenCalledWith(
			'room-1',
			'screen_share_stopped',
			expect.objectContaining({
				participantId: 'participant-1',
				producerId: 'producer-1',
				reason: 'user-click',
			}),
		);
		expect(emitScreenShare.mock.calls[0]?.[2]).not.toHaveProperty('consumerId');
		expect(callback).toHaveBeenCalledWith({ success: true });
	});

	it('authorizes the exact screen producer before broadcasting a stop', () => {
		const { assertProducerAccess, handlers } = setup();

		handlers.get('screen_share')?.({
			action: 'stop_share',
			shareData: { producerId: 'producer-1' },
		});

		expect(assertProducerAccess).toHaveBeenCalledWith(
			'producer-1',
			'room-1',
			'peer-1',
		);
	});

	it("does not broadcast another participant's producer stop", () => {
		const { assertProducerAccess, emitScreenShare, handlers } = setup();
		const callback = vi.fn();
		assertProducerAccess.mockImplementation(() => {
			throw new Error('Producer ownership mismatch');
		});

		handlers.get('screen_share')?.(
			{
				action: 'stop_share',
				shareData: { producerId: 'other-producer' },
			},
			callback,
		);

		expect(emitScreenShare).not.toHaveBeenCalled();
		expect(callback).toHaveBeenCalledWith({
			success: false,
			error: 'Producer ownership mismatch',
		});
	});

	it('does not broadcast a non-screen producer stop', () => {
		const { assertProducerAccess, emitScreenShare, handlers } = setup();
		assertProducerAccess.mockReturnValue({
			producer: { kind: 'video', appData: { type: 'camera' } },
		});

		handlers.get('screen_share')?.({
			action: 'stop_share',
			shareData: { producerId: 'camera-producer' },
		});

		expect(emitScreenShare).not.toHaveBeenCalled();
	});

	it('does not broadcast an unidentifiable screen stop', () => {
		const { emitScreenShare, handlers } = setup();
		const callback = vi.fn();

		handlers.get('screen_share')?.(
			{
				action: 'stop_share',
				shareData: { reason: 'user-click' },
			},
			callback,
		);

		expect(emitScreenShare).not.toHaveBeenCalled();
		expect(callback).toHaveBeenCalledWith({
			success: false,
			error: 'Screen share stop requires a producer identity',
		});
	});
});
