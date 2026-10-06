import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import { setTimeout as delay } from 'node:timers/promises';
import type { Producer, Router } from 'mediasoup/types';
import { expect, it, vi } from 'vitest';
import { AudioIngester } from './AudioIngester';
import type { ISttClient, ISttStream } from './SttClient';

// Opt-in test; requires FFmpeg with libopus. Media is synthetic and
// loopback only. No STT server or mediasoup worker is involved.
it.skipIf(process.env.RUN_STT_FFMPEG_TESTS !== '1')(
	'keeps one decoder and STT stream across initial inactivity and an RTP gap',
	async () => {
		const roomId = `ffmpeg-regression-${randomUUID()}`;
		const relay = dgram.createSocket('udp4');
		let relayBound = false;
		let destination = 0;
		let forward = true;
		let receivedBytes = 0;
		let sender: ChildProcess | undefined;
		let senderStderr = '';
		let senderFailure: Error | undefined;
		const onFailure = vi.fn();
		const stream: ISttStream = {
			sendAudio: (pcm) => {
				receivedBytes += pcm.length;
				return true;
			},
			markFinal: vi.fn(),
			onUnexpectedClose: vi.fn(),
			close: vi.fn(async () => {}),
		};
		const createStream = vi.fn(async () => stream);
		const client: ISttClient = {
			createStream,
			isAvailable: () => true,
			onAvailable: () => {},
		};
		const router = {
			createPlainTransport: async () => ({
				consume: async () => ({
					rtpParameters: { codecs: [{ payloadType: 111 }] },
					close: () => {},
				}),
				connect: async ({ port }: { port: number }) => {
					destination = port;
				},
				close: () => {},
			}),
		} as unknown as Router;
		const ingester = new AudioIngester({
			roomId,
			participantId: 'synthetic-speaker',
			producer: { id: 'synthetic-producer' } as Producer,
			router,
			sttClient: client,
			speechDetector: {
				mode: 'fixture',
				reset: () => {},
				detect: async () => ({ speech: true }),
			},
			onUnexpectedStreamClose: onFailure,
			onTranscript: () => {},
		});
		const assertSameCapture = () => {
			expect(createStream).toHaveBeenCalledOnce();
			expect(stream.close).not.toHaveBeenCalled();
			expect(onFailure).not.toHaveBeenCalled();
		};
		try {
			await ingester.start();
			await delay(22_000); // Previously exited after approximately 20 seconds.
			expect(receivedBytes).toBe(0);
			assertSameCapture();
			await new Promise<void>((resolve, reject) => {
				relay.once('error', reject);
				relay.bind(0, '127.0.0.1', resolve);
			});
			relayBound = true;
			relay.on('message', (packet) => {
				if (forward) relay.send(packet, destination, '127.0.0.1');
			});
			sender = spawn(
				'ffmpeg',
				[
					'-hide_banner',
					'-loglevel',
					'error',
					'-re',
					'-f',
					'lavfi',
					'-i',
					'sine=frequency=440:sample_rate=48000',
					'-ac',
					'2',
					'-c:a',
					'libopus',
					'-payload_type',
					'111',
					'-f',
					'rtp',
					`rtp://127.0.0.1:${relay.address().port}?pkt_size=1200`,
				],
				{ stdio: ['ignore', 'ignore', 'pipe'] },
			);
			sender.on('error', (error) => {
				senderFailure = error;
			});
			sender.stderr?.on('data', (chunk: Buffer) => {
				senderStderr = (senderStderr + chunk.toString()).slice(-2000);
			});
			await vi.waitFor(
				() => {
					if (senderFailure) throw senderFailure;
					expect(receivedBytes, senderStderr).toBeGreaterThan(48_000);
				},
				{ timeout: 8000, interval: 100 },
			);
			assertSameCapture();
			// Drop RTP while the sender continues; SSRC/sequence/timestamps remain
			// continuous, avoiding restarted senders as a resumption confounder.
			forward = false;
			await delay(13_000);
			assertSameCapture();
			const bytesBeforeResume = receivedBytes;
			forward = true;
			await vi.waitFor(
				() =>
					expect(receivedBytes, senderStderr).toBeGreaterThan(
						bytesBeforeResume + 48_000,
					),
				{ timeout: 8000, interval: 100 },
			);
			assertSameCapture();
		} finally {
			if (
				sender?.pid &&
				sender.exitCode === null &&
				sender.signalCode === null
			) {
				const exited = new Promise<void>((resolve) =>
					sender!.once('exit', () => resolve()),
				);
				sender.kill('SIGKILL');
				await exited;
			}
			if (relayBound) relay.close();
			await ingester.stop();
		}
		expect(stream.close).toHaveBeenCalledOnce();
	},
	70_000,
);
