import { describe, expect, it, vi } from 'vitest';
import { SttManager } from '../../stt/SttManager';
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
		const events: string[] = [];
		const startSttForExistingProducers = vi.fn(async () => {
			events.push('producer startup');
		});
		registerSttHandlers({
			authManager: { ensureFullAccess: vi.fn() },
			sttManager: {
				beginSession: vi.fn(() => true),
			},
			mediasoup: { startSttForExistingProducers },
		} as never)(socket as never);
		const callback = vi.fn((result: unknown) => {
			events.push('acknowledgement');
			return result;
		});

		toggle?.({ enabled: true }, callback);

		expect(callback).toHaveBeenCalledWith({ success: true, enabled: true });
		expect(events).toEqual(['acknowledgement', 'producer startup']);
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
		const beginSession = vi.fn();
		registerSttHandlers({
			authManager: { ensureFullAccess: vi.fn() },
			sttManager: {
				beginSession,
			},
		} as never)(socket as never);
		const callback = vi.fn();

		toggle?.({ enabled: true }, callback);

		expect(callback).toHaveBeenCalledWith({
			success: false,
			error: 'Captions are unavailable when E2EE is required',
		});
		expect(beginSession).not.toHaveBeenCalled();
	});

	it('ignores malformed toggles without an acknowledgement callback', async () => {
		let toggle:
			| ((data: unknown, callback?: unknown) => Promise<void>)
			| undefined;
		const ensureFullAccess = vi.fn(() => {
			throw new Error('should not authenticate malformed event');
		});
		registerSttHandlers({ authManager: { ensureFullAccess } } as never)({
			on: (event: string, handler: typeof toggle) => {
				if (event === 'stt:toggle') toggle = handler;
			},
		} as never);

		await expect(toggle?.({ enabled: true })).resolves.toBeUndefined();
		expect(ensureFullAccess).not.toHaveBeenCalled();
	});

	it('rejects malformed enabled values', () => {
		let toggle:
			| ((data: unknown, callback: (result: unknown) => void) => void)
			| undefined;
		const beginSession = vi.fn();
		registerSttHandlers({
			authManager: { ensureFullAccess: vi.fn() },
			sttManager: { beginSession },
		} as never)({
			id: 'socket-1',
			roomId: 'room-1',
			e2eeRequired: false,
			on: (event: string, handler: typeof toggle) => {
				if (event === 'stt:toggle') toggle = handler;
			},
		} as never);
		const callback = vi.fn();

		toggle?.({ enabled: 'yes' }, callback);

		expect(callback).toHaveBeenCalledWith({
			success: false,
			error: 'enabled must be a boolean',
		});
		expect(beginSession).not.toHaveBeenCalled();
	});

	it('rejects caption enable when STT is unavailable', () => {
		let toggle:
			| ((data: unknown, callback: (result: unknown) => void) => void)
			| undefined;
		registerSttHandlers({
			authManager: { ensureFullAccess: vi.fn() },
			sttManager: new SttManager({}),
		} as never)({
			id: 'socket-1',
			roomId: 'room-1',
			e2eeRequired: false,
			on: (event: string, handler: typeof toggle) => {
				if (event === 'stt:toggle') toggle = handler;
			},
		} as never);
		const callback = vi.fn();

		toggle?.({ enabled: true }, callback);

		expect(callback).toHaveBeenCalledWith({
			success: false,
			error: 'STT is unavailable',
		});
	});
});
