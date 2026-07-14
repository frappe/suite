import { afterEach, describe, expect, it, vi } from 'vitest';
import { Telemetry } from '../../telemetry/Telemetry';
import { RouteManager } from '../RouteManager';

function createHarness(token?: string) {
	if (token) process.env.METRICS_TOKEN = token;
	else delete process.env.METRICS_TOKEN;
	const handlers = new Map<string, (req: never, res: never) => unknown>();
	const app = {
		get: vi.fn((path: string, handler: (req: never, res: never) => unknown) => {
			handlers.set(path, handler);
		}),
	};
	const mediasoup = {
		getResourceCounts: vi.fn(() => ({ rooms: 2, peers: 4 })),
		rooms: { getRoomCount: vi.fn(() => 2) },
		peers: { getPeerCount: vi.fn(() => 4) },
	};
	const telemetry = new Telemetry();
	new RouteManager(
		app as never,
		mediasoup as never,
		telemetry,
		() => 5,
	).setupRoutes();
	return { handlers, telemetry };
}

function createResponse() {
	return {
		set: vi.fn(),
		send: vi.fn(),
		sendStatus: vi.fn(),
		json: vi.fn(),
	};
}

describe('RouteManager metrics endpoint', () => {
	afterEach(() => delete process.env.METRICS_TOKEN);

	it('requires a configured bearer token', async () => {
		const { handlers } = createHarness('secret');
		const response = createResponse();

		await handlers.get('/metrics')?.(
			{ headers: { authorization: 'Bearer wrong' } } as never,
			response as never,
		);

		expect(response.sendStatus).toHaveBeenCalledWith(401);
	});

	it('exports current SFU resources for an authorized scrape', async () => {
		const { handlers, telemetry } = createHarness('secret');
		const response = createResponse();

		await handlers.get('/metrics')?.(
			{ headers: { authorization: 'Bearer secret' } } as never,
			response as never,
		);

		expect(response.set).toHaveBeenCalledWith(
			'Content-Type',
			telemetry.registry.contentType,
		);
		expect(response.send).toHaveBeenCalledWith(
			expect.stringContaining('meet_sfu_resources{resource="sockets"} 5'),
		);
	});
});
