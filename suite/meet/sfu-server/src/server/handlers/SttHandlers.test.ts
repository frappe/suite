import { describe, expect, it, vi } from 'vitest';
import { registerSttHandlers } from './SttHandlers';

describe('registerSttHandlers', () => {
	it('acknowledges subscriptions before starting existing producers', async () => {
		let toggle:
			| ((data: unknown, callback: (result: unknown) => void) => void)
			| undefined;
		const socket = {
			id: 'socket-1',
			roomId: 'room-1',
			e2eeRequired: false,
			on: (event: string, handler: typeof toggle) => {
				if (event === 'stt:toggle') toggle = handler;
			},
		};
		let finishStart: () => void = () => {};
		const startSttForExistingProducers = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishStart = resolve;
				}),
		);
		registerSttHandlers({
			authManager: { ensureFullAccess: vi.fn() },
			sttManager: { addSubscriber: vi.fn(() => true) },
			mediasoup: { startSttForExistingProducers },
		} as never)(socket as never);
		const callback = vi.fn();

		toggle?.({ enabled: true }, callback);

		expect(callback).toHaveBeenCalledWith({ success: true, enabled: true });
		expect(startSttForExistingProducers).toHaveBeenCalledOnce();
		finishStart();
	});

	it('rejects caption subscriptions when E2EE is required', () => {
		let toggle:
			| ((data: unknown, callback: (result: unknown) => void) => void)
			| undefined;
		const socket = {
			id: 'socket-1',
			roomId: 'room-1',
			e2eeRequired: true,
			on: (event: string, handler: typeof toggle) => {
				if (event === 'stt:toggle') toggle = handler;
			},
		};
		const addSubscriber = vi.fn();
		registerSttHandlers({
			authManager: { ensureFullAccess: vi.fn() },
			sttManager: { addSubscriber },
		} as never)(socket as never);
		const callback = vi.fn();

		toggle?.({ enabled: true }, callback);

		expect(callback).toHaveBeenCalledWith({
			success: false,
			error: 'Captions are unavailable when E2EE is required',
		});
		expect(addSubscriber).not.toHaveBeenCalled();
	});
});
