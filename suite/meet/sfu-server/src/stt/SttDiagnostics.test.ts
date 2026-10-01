import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Consumer, Producer } from 'mediasoup/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { SttClient } from './SttClient';
import { SttDiagnostics } from './SttDiagnostics';

const identity = {
	roomId: 'diagnostic-room',
	participantId: 'speaker',
	producerId: 'producer',
	sessionId: 'stream',
};
const temporary: string[] = [];
function directory() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-diagnostic-test-'));
	temporary.push(root);
	vi.stubEnv('STT_DIAGNOSTICS_DIR', root);
	vi.stubEnv('STT_DIAGNOSTICS_ROOM_ID', identity.roomId);
	vi.stubEnv('STT_DIAGNOSTICS_ROOM_IDS', undefined);
	vi.stubEnv('STT_DIAGNOSTICS_MAX_SESSIONS', undefined);
	return root;
}
function captured(root: string) {
	return path.join(root, fs.readdirSync(root)[0]);
}
function events(root: string) {
	return fs
		.readFileSync(path.join(captured(root), 'events.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
	for (const root of temporary.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

describe('private STT diagnostic captures', () => {
	it('requires both an absolute output directory and an exact room match', () => {
		const root = directory();
		vi.stubEnv('STT_DIAGNOSTICS_ROOM_ID', 'different-room');
		expect(SttDiagnostics.create(identity)).toBeUndefined();
		vi.stubEnv('STT_DIAGNOSTICS_ROOM_ID', identity.roomId);
		vi.stubEnv('STT_DIAGNOSTICS_DIR', 'relative-path');
		expect(SttDiagnostics.create(identity)).toBeUndefined();
		vi.stubEnv('STT_DIAGNOSTICS_DIR', '');
		expect(SttDiagnostics.create(identity)).toBeUndefined();
		expect(fs.readdirSync(root)).toEqual([]);
	});

	it('accepts a bounded exact room allowlist and rejects wildcards or excessive limits', async () => {
		const root = directory();
		vi.stubEnv('STT_DIAGNOSTICS_ROOM_IDS', 'other-room, diagnostic-room');
		vi.stubEnv('STT_DIAGNOSTICS_MAX_SESSIONS', '20');
		const capture = SttDiagnostics.create(identity);
		expect(capture).toBeDefined();
		await capture!.close();
		vi.stubEnv('STT_DIAGNOSTICS_ROOM_IDS', '*');
		expect(SttDiagnostics.create(identity)).toBeUndefined();
		vi.stubEnv('STT_DIAGNOSTICS_ROOM_IDS', identity.roomId);
		vi.stubEnv('STT_DIAGNOSTICS_MAX_SESSIONS', '21');
		expect(SttDiagnostics.create(identity)).toBeUndefined();
		expect(fs.readdirSync(root)).toHaveLength(1);
	});

	it('preserves independent PCM boundaries and commit offsets in private artifacts', async () => {
		const root = directory();
		vi.stubEnv('STT_DIAGNOSTICS_ROOM_IDS', ''); // Compose's unset plural value.
		const capture = SttDiagnostics.create(identity)!;
		const raw = Buffer.from([1, 0, 2, 0, 3, 0]);
		const speech = Buffer.from([2, 0, 3, 0]);
		capture.pcm('before-vad', raw);
		capture.pcm('stt-sent', speech);
		capture.commit();
		capture.event('stt.received', {
			eventType: 'conversation.item.input_audio_transcription.completed',
			itemId: 'item',
			transcript: 'hello',
		});
		await capture.close();
		const output = captured(root);
		expect(fs.readFileSync(path.join(output, 'before-vad.pcm'))).toEqual(raw);
		expect(fs.readFileSync(path.join(output, 'stt-sent.pcm'))).toEqual(speech);
		expect(events(root)).toContainEqual(
			expect.objectContaining({ type: 'stt.commit.sent', audioOffset: 4 }),
		);
		expect(events(root)).toContainEqual(
			expect.objectContaining({ type: 'stt.received', transcript: 'hello' }),
		);
		expect(events(root).at(-1)).toMatchObject({
			type: 'capture.end',
			reason: 'ingester-stopped',
			offsets: { 'before-vad': 6, 'stt-sent': 4 },
		});
		expect(fs.statSync(output).mode & 0o777).toBe(0o700);
		for (const file of fs.readdirSync(output))
			expect(fs.statSync(path.join(output, file)).mode & 0o777).toBe(0o600);
	});

	it('captures queued websocket audio and authoritative transcripts without auth or server error contents', async () => {
		const root = directory();
		const capture = SttDiagnostics.create(identity)!;
		const server = createServer((_request, response) => response.end('ok'));
		const websocket = new WebSocketServer({ server, path: '/v1/realtime' });
		await new Promise<void>((resolve) =>
			server.listen(0, '127.0.0.1', resolve),
		);
		const address = server.address();
		if (!address || typeof address === 'string')
			throw new Error('No server address');
		websocket.on('connection', (socket) => {
			socket.send(JSON.stringify({ type: 'session.created' }));
			socket.on('message', (raw) => {
				const event = JSON.parse(raw.toString());
				if (event.type === 'session.update')
					socket.send(JSON.stringify({ type: 'session.updated' }));
				if (event.type === 'input_audio_buffer.commit') {
					socket.send(
						JSON.stringify({
							type: 'input_audio_buffer.committed',
							item_id: 'fixture-item',
						}),
					);
					socket.send(
						JSON.stringify({
							type: 'conversation.item.input_audio_transcription.completed',
							item_id: 'fixture-item',
							transcript: 'hello world',
							error: { message: 'private-server-details' },
						}),
					);
				}
			});
		});
		const client = new SttClient(
			`http://127.0.0.1:${address.port}`,
			'private-auth-token',
		);
		let finished: () => void = () => {};
		const completed = new Promise<void>((resolve) => {
			finished = resolve;
		});
		const stream = await client.createStream(
			{
				sessionId: 'stream',
				sampleRate: 24000,
				language: 'auto',
				diagnostics: capture,
			},
			(event) => {
				if (event.isFinal) finished();
			},
		);
		try {
			const audio = Buffer.from([1, 0, 2, 0]);
			expect(stream.sendAudio(audio)).toBe(true);
			stream.markFinal(100);
			await completed;
			await stream.close();
			await capture.close();
			expect(
				fs.readFileSync(path.join(captured(root), 'stt-sent.pcm')),
			).toEqual(audio);
			expect(events(root)).toContainEqual(
				expect.objectContaining({ type: 'stt.commit.sent', audioOffset: 4 }),
			);
			expect(events(root)).toContainEqual(
				expect.objectContaining({
					type: 'stt.session.update.sent',
					language: 'auto',
					sampleRate: 24000,
					names: [],
				}),
			);
			expect(events(root)).toContainEqual(
				expect.objectContaining({
					type: 'stt.received',
					transcript: 'hello world',
					itemId: 'fixture-item',
				}),
			);
			expect(events(root)).toContainEqual(
				expect.objectContaining({
					type: 'stt.emitted',
					text: 'hello world',
					isFinal: true,
				}),
			);
			const stored = fs.readFileSync(
				path.join(captured(root), 'events.jsonl'),
				'utf8',
			);
			expect(stored).not.toContain('private-auth-token');
			expect(stored).not.toContain('private-server-details');
		} finally {
			await stream.close();
			await capture.close();
			client.destroy();
			await new Promise<void>((resolve) => websocket.close(() => resolve()));
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it('records RTP counters and pause state without endpoint addresses or unrelated metadata', async () => {
		const root = directory();
		const capture = SttDiagnostics.create(identity)!;
		const producer = {
			paused: false,
			closed: false,
			getStats: async () => [
				{
					type: 'inbound-rtp',
					packetCount: 15,
					byteCount: 1500,
					ssrc: 123,
					localIp: '127.0.0.1',
					token: 'private-token',
				},
			],
		} as unknown as Producer;
		const consumer = {
			paused: false,
			producerPaused: false,
			closed: false,
			getStats: async () => [
				{
					type: 'outbound-rtp',
					packetCount: 14,
					byteCount: 1400,
					remoteIp: '127.0.0.2',
				},
			],
		} as unknown as Consumer;
		await capture.rtpStats(producer, consumer);
		await capture.close();
		expect(events(root)).toContainEqual(
			expect.objectContaining({
				type: 'rtp.stats',
				producerPaused: false,
				consumerPaused: false,
				producerStats: [
					{ type: 'inbound-rtp', packetCount: 15, byteCount: 1500, ssrc: 123 },
				],
				consumerStats: [
					{ type: 'outbound-rtp', packetCount: 14, byteCount: 1400 },
				],
				producerStatsUnavailable: false,
				consumerStatsUnavailable: false,
			}),
		);
		const stored = fs.readFileSync(
			path.join(captured(root), 'events.jsonl'),
			'utf8',
		);
		expect(stored).not.toContain('127.0.0');
		expect(stored).not.toContain('private-token');
	});

	it('stops a diagnostic slice at 60 seconds and ignores subsequent audio', async () => {
		const root = directory();
		vi.useFakeTimers();
		const capture = SttDiagnostics.create(identity)!;
		capture.pcm('before-vad', Buffer.from([1, 0]));
		vi.advanceTimersByTime(60_000);
		capture.pcm('before-vad', Buffer.from([2, 0]));
		await capture.close();
		expect(
			fs.readFileSync(path.join(captured(root), 'before-vad.pcm')),
		).toEqual(Buffer.from([1, 0]));
		expect(events(root).at(-1)).toMatchObject({ reason: 'time-limit' });
	});

	it('does not enqueue oversized buffers or let diagnostic storage failure escape', async () => {
		const root = directory();
		const capture = SttDiagnostics.create(identity)!;
		capture.pcm('before-vad', Buffer.alloc(3_000_000));
		await capture.close();
		expect(
			fs.readFileSync(path.join(captured(root), 'before-vad.pcm')),
		).toHaveLength(0);
		expect(events(root).at(-1)).toMatchObject({ reason: 'pcm-limit' });
		const file = path.join(root, 'file');
		fs.writeFileSync(file, 'not a directory');
		vi.stubEnv('STT_DIAGNOSTICS_DIR', file);
		expect(() => SttDiagnostics.create(identity)).not.toThrow();
		expect(SttDiagnostics.create(identity)).toBeUndefined();
	});
});
