import type { Producer, Router } from 'mediasoup/types';
import { describe, expect, it, vi } from 'vitest';
import { AudioIngester } from './AudioIngester';
import { AudioPreRoll } from './AudioPreRoll';
import type { ISttClient, ISttStream } from './SttClient';

const FRAME_BYTES = 4800;

function speechFrame(): Buffer {
	const frame = Buffer.alloc(FRAME_BYTES);
	for (let offset = 0; offset < frame.length; offset += 2) {
		frame.writeInt16LE(16_000, offset);
	}
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

	it('drains every complete queued VAD frame in one check', async () => {
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
		const silence = Buffer.alloc(FRAME_BYTES);
		const speech1 = speechFrame();
		const speechSilence = Buffer.alloc(FRAME_BYTES);
		const speech2 = speechFrame();
		const remainder = Buffer.alloc(FRAME_BYTES / 2);
		const internals = ingester as unknown as {
			vadQueue: Buffer[];
			vadQueueBytes: number;
			sttStream: ISttStream;
			preRoll: AudioPreRoll;
			speechCheckCount: number;
			silenceCheckCount: number;
			isInSpeech: boolean;
			streamedBytes: number;
			runVadCheck(): Promise<void>;
			shouldFlush(): boolean;
		};
		internals.vadQueue = [silence, speech1, speechSilence, speech2, remainder];
		internals.vadQueueBytes = FRAME_BYTES * 4.5;
		internals.sttStream = stream;
		internals.preRoll = new AudioPreRoll(3);
		const shouldFlush = vi
			.spyOn(internals, 'shouldFlush')
			.mockReturnValue(false);

		await internals.runVadCheck();

		expect(stream.sendAudio.mock.calls.map(([frame]) => frame)).toEqual([
			silence,
			speech1,
			speechSilence,
			speech2,
		]);
		expect(internals.vadQueueBytes).toBe(FRAME_BYTES / 2);
		expect(internals.vadQueue).toEqual([remainder]);
		expect(internals.speechCheckCount).toBe(2);
		expect(internals.silenceCheckCount).toBe(0);
		expect(internals.isInSpeech).toBe(true);
		expect(internals.streamedBytes).toBe(FRAME_BYTES * 4);
		expect(shouldFlush).toHaveBeenCalledTimes(4);
	});
});
