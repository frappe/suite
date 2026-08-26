import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type WebSocket, WebSocketServer } from 'ws';
import { SttClient, type SttTranscriptEvent } from './SttClient';

interface ClientEvent {
	type?: string;
	audio?: string;
	session?: {
		type?: string;
		audio?: { input?: { format?: { type?: string; rate?: number } } };
	};
}

describe('SttClient Realtime protocol', () => {
	let server: Server | undefined;
	let websocketServer: WebSocketServer | undefined;
	let client: SttClient | undefined;

	afterEach(async () => {
		client?.destroy();
		vi.restoreAllMocks();
		await new Promise<void>(
			(resolve) => websocketServer?.close(() => resolve()) ?? resolve(),
		);
		await new Promise<void>(
			(resolve) => server?.close(() => resolve()) ?? resolve(),
		);
	});

	it('configures a transcription session and maps committed item events to Meet transcripts', async () => {
		server = createServer((_request, response) => {
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end('{"status":"ok"}');
		});
		websocketServer = new WebSocketServer({ server, path: '/v1/realtime' });
		await new Promise<void>((resolve) =>
			server!.listen(0, '127.0.0.1', resolve),
		);
		const address = server.address();
		if (!address || typeof address === 'string')
			throw new Error('Missing test server address');

		const clientEvents: ClientEvent[] = [];
		websocketServer.on('connection', (socket) => {
			socket.send(
				JSON.stringify({
					type: 'session.created',
					event_id: 'event-created',
					session: { id: 'sess-1', type: 'transcription' },
				}),
			);
			socket.on('message', (raw) => {
				const event = JSON.parse(raw.toString()) as ClientEvent;
				clientEvents.push(event);
				if (event.type === 'session.update') {
					socket.send(
						JSON.stringify({
							type: 'session.updated',
							event_id: 'event-updated',
							session: { id: 'sess-1', type: 'transcription' },
						}),
					);
				}
				if (event.type === 'input_audio_buffer.commit') {
					socket.send(
						JSON.stringify({
							type: 'input_audio_buffer.committed',
							event_id: 'event-committed',
							item_id: 'item-1',
							previous_item_id: null,
						}),
					);
					socket.send(
						JSON.stringify({
							type: 'conversation.item.input_audio_transcription.delta',
							event_id: 'event-delta',
							item_id: 'item-1',
							content_index: 0,
							delta: 'hello',
						}),
					);
					socket.send(
						JSON.stringify({
							type: 'conversation.item.input_audio_transcription.completed',
							event_id: 'event-completed',
							item_id: 'item-1',
							content_index: 0,
							transcript: 'hello world',
							usage: { type: 'duration', seconds: 0.1 },
						}),
					);
				}
			});
		});

		client = new SttClient(`http://127.0.0.1:${address.port}`);
		const transcripts: SttTranscriptEvent[] = [];
		const stream = await client.createStream(
			{
				sessionId: 'meet-session-1',
				roomId: 'room-1',
				participantId: 'participant-1',
				producerId: 'producer-1',
				sampleRate: 24000,
				language: 'en-US',
			},
			(event) => transcripts.push(event),
		);
		const unexpectedClose = vi.fn();
		stream.onUnexpectedClose(unexpectedClose);

		stream.sendAudio(Buffer.from([0, 0, 1, 0]));
		stream.markFinal(100);
		await stream.close();

		const update = clientEvents.find(
			(event) => event.type === 'session.update',
		);
		const append = clientEvents.find(
			(event) => event.type === 'input_audio_buffer.append',
		);
		expect(update).toMatchObject({
			session: {
				type: 'transcription',
				audio: { input: { format: { type: 'audio/pcm', rate: 24000 } } },
			},
		});
		expect(append).toMatchObject({
			audio: Buffer.from([0, 0, 1, 0]).toString('base64'),
		});
		expect(transcripts).toEqual([
			{ text: 'hello', isFinal: false, durationMs: 100, sequence: 1 },
			{ text: 'hello world', isFinal: true, durationMs: 100, sequence: 2 },
		]);
		expect(unexpectedClose).not.toHaveBeenCalled();
	});

	it('reports a configured Realtime stream closing unexpectedly', async () => {
		server = createServer((_request, response) => {
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end('{"status":"ok"}');
		});
		websocketServer = new WebSocketServer({ server, path: '/v1/realtime' });
		await new Promise<void>((resolve) =>
			server!.listen(0, '127.0.0.1', resolve),
		);
		const address = server.address();
		if (!address || typeof address === 'string')
			throw new Error('Missing test server address');

		let serverSocket: WebSocket | undefined;
		websocketServer.on('connection', (socket) => {
			serverSocket = socket;
			socket.send(JSON.stringify({ type: 'session.created' }));
			socket.on('message', (raw) => {
				const event = JSON.parse(raw.toString()) as ClientEvent;
				if (event.type === 'session.update') {
					socket.send(JSON.stringify({ type: 'session.updated' }));
				}
			});
		});

		client = new SttClient(`http://127.0.0.1:${address.port}`);
		const stream = await client.createStream(
			{
				sessionId: 'meet-session-1',
				roomId: 'room-1',
				participantId: 'participant-1',
				producerId: 'producer-1',
				sampleRate: 24000,
			},
			vi.fn(),
		);
		const unexpectedClose = vi.fn();
		stream.onUnexpectedClose(unexpectedClose);

		serverSocket?.close(1011, 'backend failure');
		await vi.waitFor(() => expect(unexpectedClose).toHaveBeenCalledTimes(1));
		await stream.close();
		expect(unexpectedClose).toHaveBeenCalledTimes(1);
	});

	it('delivers an unexpected close that occurs before listener registration', async () => {
		server = createServer((_request, response) => {
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end('{"status":"ok"}');
		});
		websocketServer = new WebSocketServer({ server, path: '/v1/realtime' });
		await new Promise<void>((resolve) =>
			server!.listen(0, '127.0.0.1', resolve),
		);
		const address = server.address();
		if (!address || typeof address === 'string')
			throw new Error('Missing test server address');

		websocketServer.on('connection', (socket) => {
			socket.send(JSON.stringify({ type: 'session.created' }));
			socket.on('message', (raw) => {
				const event = JSON.parse(raw.toString()) as ClientEvent;
				if (event.type === 'session.update') {
					socket.send(JSON.stringify({ type: 'session.updated' }), () => {
						socket.close(1011, 'backend failure');
					});
				}
			});
		});

		client = new SttClient(`http://127.0.0.1:${address.port}`);
		const stream = await client.createStream(
			{
				sessionId: 'meet-session-1',
				roomId: 'room-1',
				participantId: 'participant-1',
				producerId: 'producer-1',
				sampleRate: 24000,
			},
			vi.fn(),
		);
		await vi.waitFor(() => {
			const internals = stream as unknown as { unexpectedlyClosed: boolean };
			expect(internals.unexpectedlyClosed).toBe(true);
		});
		const unexpectedClose = vi.fn();

		stream.onUnexpectedClose(unexpectedClose);

		expect(unexpectedClose).toHaveBeenCalledTimes(1);
		await stream.close();
	});

	it('sends the configured API key as a bearer token', async () => {
		const authHeaders: (string | undefined)[] = [];
		server = createServer((request, response) => {
			authHeaders.push(request.headers.authorization);
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end('{"status":"ok"}');
		});
		websocketServer = new WebSocketServer({ server, path: '/v1/realtime' });
		await new Promise<void>((resolve) =>
			server!.listen(0, '127.0.0.1', resolve),
		);
		const address = server.address();
		if (!address || typeof address === 'string')
			throw new Error('Missing test server address');
		websocketServer.on('connection', (socket, request) => {
			authHeaders.push(request.headers.authorization);
			socket.send(JSON.stringify({ type: 'session.created' }));
			socket.on('message', (raw) => {
				const event = JSON.parse(raw.toString()) as ClientEvent;
				if (event.type === 'session.update') {
					socket.send(JSON.stringify({ type: 'session.updated' }));
				}
			});
		});

		client = new SttClient(`http://127.0.0.1:${address.port}`, 'test-key');
		await vi.waitFor(() => expect(client.isAvailable()).toBe(true));
		const stream = await client.createStream(
			{
				sessionId: 'meet-session-1',
				roomId: 'room-1',
				participantId: 'participant-1',
				producerId: 'producer-1',
				sampleRate: 24000,
			},
			vi.fn(),
		);

		expect(
			authHeaders.filter((header) => header === 'Bearer test-key'),
		).toHaveLength(2);
		await stream.close();
	});

	it('treats a missing health endpoint as reachable', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: false,
			status: 404,
		} as Response);
		client = new SttClient('http://stt.example');
		const internals = client as unknown as { checkHealth: () => void };

		internals.checkHealth();

		await vi.waitFor(() => expect(client!.isAvailable()).toBe(true));
	});

	it('notifies after each unhealthy-to-healthy recovery', async () => {
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce({ ok: false, status: 503 } as Response)
			.mockResolvedValueOnce({ ok: true } as Response)
			.mockResolvedValueOnce({ ok: false, status: 503 } as Response)
			.mockResolvedValueOnce({ ok: true } as Response);
		client = new SttClient('http://stt.example');
		const recovered = vi.fn();
		client.onAvailable(recovered);
		const internals = client as unknown as {
			checkHealth: () => void;
			healthCheckInFlight: boolean;
		};

		await vi.waitFor(() => expect(internals.healthCheckInFlight).toBe(false));
		internals.checkHealth();
		await vi.waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(internals.healthCheckInFlight).toBe(false));
		internals.checkHealth();
		await vi.waitFor(() => expect(internals.healthCheckInFlight).toBe(false));
		expect(client.isAvailable()).toBe(false);
		internals.checkHealth();
		await vi.waitFor(() => expect(recovered).toHaveBeenCalledTimes(2));

		expect(fetchMock).toHaveBeenCalledTimes(4);
	});
});
