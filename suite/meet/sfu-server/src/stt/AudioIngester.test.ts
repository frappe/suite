import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Producer, Router } from 'mediasoup/types';
import { describe, expect, it, vi } from 'vitest';
import { AudioIngester } from './AudioIngester';
import type { ISttClient, ISttStream } from './SttClient';

const FRAME_BYTES = 4800;

function speechFrame(): Buffer {
	const frame = Buffer.alloc(FRAME_BYTES);
	for (let offset = 0; offset < frame.length; offset += 2) {
		frame.writeInt16LE(16_000, offset);
	}
	return frame;
}

function silenceFrame(value = 0): Buffer {
	const frame = Buffer.alloc(FRAME_BYTES);
	frame.writeInt16LE(value, 0);
	return frame;
}

describe('AudioIngester', () => {
	it('cleans up a transport created after stop begins', async () => {
		const sttClient = {
			isAvailable: () => true,
			onAvailable: vi.fn(),
			createStream: vi.fn(),
		} satisfies ISttClient;
		const ingester = new AudioIngester({
			roomId: 'room-1',
			participantId: 'participant-1',
			producer: { id: 'producer-1' } as Producer,
			router: {} as Router,
			sttClient,
			onUnexpectedStreamClose: vi.fn(),
			onTranscript: vi.fn(),
		});
		let finishSetup: () => void = () => {};
		const transport = { close: vi.fn() };
		const internals = ingester as unknown as {
			plainTransport: typeof transport | null;
			setupPlainTransport(): Promise<void>;
			createConsumer(): Promise<void>;
		};
		vi.spyOn(internals, 'setupPlainTransport').mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishSetup = () => {
						internals.plainTransport = transport;
						resolve();
					};
				}),
		);
		const createConsumer = vi.spyOn(internals, 'createConsumer');

		const start = ingester.start();
		await ingester.stop();
		finishSetup();
		await start;

		expect(transport.close).toHaveBeenCalledOnce();
		expect(createConsumer).not.toHaveBeenCalled();
	});

	it('drains queued VAD frames with capped pre-roll ordering', async () => {
		const stream = {
			sendAudio: vi.fn(),
			markFinal: vi.fn(),
			onUnexpectedClose: vi.fn(),
			close: vi.fn<() => Promise<void>>().mockResolvedValue(),
		} satisfies ISttStream;
		const sttClient = {
			isAvailable: () => true,
			onAvailable: vi.fn(),
			createStream: vi.fn(),
		} satisfies ISttClient;
		const ingester = new AudioIngester({
			roomId: 'room-1',
			participantId: 'participant-1',
			producer: { id: 'producer-1' } as Producer,
			router: {} as Router,
			sttClient,
			onUnexpectedStreamClose: vi.fn(),
			onTranscript: vi.fn(),
		});
		const silences = Array.from({ length: 5 }, (_, index) =>
			silenceFrame(index + 1),
		);
		const speech1 = speechFrame();
		const speechSilence = silenceFrame();
		const speech2 = speechFrame();
		const remainder = Buffer.alloc(FRAME_BYTES / 2);
		const internals = ingester as unknown as {
			vadQueue: Buffer[];
			vadQueueBytes: number;
			sttStream: ISttStream;
			runVadCheck(): Promise<void>;
		};
		internals.vadQueue = [
			...silences,
			speech1,
			speechSilence,
			speech2,
			remainder,
		];
		internals.vadQueueBytes = FRAME_BYTES * 8.5;
		internals.sttStream = stream;

		await internals.runVadCheck();

		expect(stream.sendAudio.mock.calls.map(([frame]) => frame)).toEqual([
			...silences.slice(-3),
			speech1,
			speechSilence,
			speech2,
		]);
		expect(stream.markFinal).not.toHaveBeenCalled();
	});

	it('finalizes continuous speech at the maximum utterance duration', async () => {
		const stream = {
			sendAudio: vi.fn(),
			markFinal: vi.fn(),
			onUnexpectedClose: vi.fn(),
			close: vi.fn<() => Promise<void>>().mockResolvedValue(),
		} satisfies ISttStream;
		const ingester = new AudioIngester({
			roomId: 'room-1',
			participantId: 'participant-1',
			producer: { id: 'producer-1' } as Producer,
			router: {} as Router,
			sttClient: {} as ISttClient,
			onUnexpectedStreamClose: vi.fn(),
			onTranscript: vi.fn(),
		});
		const internals = ingester as unknown as {
			vadQueue: Buffer[];
			vadQueueBytes: number;
			sttStream: ISttStream;
			runVadCheck(): Promise<void>;
		};
		internals.vadQueue = Array.from({ length: 151 }, speechFrame);
		internals.vadQueueBytes = FRAME_BYTES * 151;
		internals.sttStream = stream;

		await internals.runVadCheck();

		expect(stream.markFinal).toHaveBeenCalledOnce();
		expect(stream.markFinal).toHaveBeenCalledWith(15_000);
	});

	it('reports FFmpeg failure once and suppresses exit during normal stop', async () => {
		const onFailure = vi.fn();
		const ingester = new AudioIngester({
			roomId: 'room-1',
			participantId: 'participant-1',
			producer: { id: 'producer-1' } as Producer,
			router: {} as Router,
			sttClient: {} as ISttClient,
			onUnexpectedStreamClose: onFailure,
			onTranscript: vi.fn(),
		});
		const process = new EventEmitter() as ChildProcess;
		Object.assign(process, {
			killed: false,
			exitCode: null,
			signalCode: null,
			kill: vi.fn(() => {
				process.emit('exit', 0, null);
				return true;
			}),
		});
		const internals = ingester as unknown as {
			running: boolean;
			ffmpeg: ChildProcess | null;
			watchFfmpeg(process: ChildProcess): void;
		};
		internals.running = true;
		internals.ffmpeg = process;
		internals.watchFfmpeg(process);

		process.emit('error', new Error('decoder failed'));
		process.emit('exit', 1, null);
		expect(onFailure).toHaveBeenCalledOnce();

		onFailure.mockClear();
		await ingester.stop();
		expect(onFailure).not.toHaveBeenCalled();
	});
});
