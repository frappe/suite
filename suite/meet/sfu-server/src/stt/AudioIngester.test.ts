import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Producer, Router } from 'mediasoup/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioIngester } from './AudioIngester';
import type { SpeechDetector } from './SpeechDetector';
import * as detectorModule from './SpeechDetector';
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

// A fixture marker, not a speech classifier: speechFrame has sample 16000.
function fixtureDetector(): SpeechDetector {
	return {
		mode: 'test',
		reset: vi.fn(),
		detect: async (audio) => ({ speech: audio.readInt16LE(0) === 16000 }),
	};
}

function testStream() {
	return {
		sendAudio: vi.fn(() => true),
		markFinal: vi.fn(),
		onUnexpectedClose: vi.fn(),
		close: vi.fn<() => Promise<void>>().mockResolvedValue(),
	} satisfies ISttStream;
}

function testIngester(
	options: Partial<ConstructorParameters<typeof AudioIngester>[0]> = {},
) {
	return new AudioIngester({
		speechDetector: fixtureDetector(),
		roomId: 'room',
		participantId: 'speaker',
		producer: { id: 'producer' } as Producer,
		router: {} as Router,
		sttClient: {} as ISttClient,
		onUnexpectedStreamClose: vi.fn(),
		onTranscript: vi.fn(),
		...options,
	});
}

describe('AudioIngester', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});
	it('uses detector speech decisions rather than amplitude while preserving pre-roll and short-utterance silence', async () => {
		const decisions = [
			false,
			false,
			false,
			true,
			true,
			false,
			false,
			false,
			false,
			false,
			false,
			false,
		];
		const detector: SpeechDetector = {
			mode: 'test',
			reset: vi.fn(),
			detect: vi.fn(async () => ({ speech: decisions.shift()! })),
		};
		const stream = testStream();
		const ingester = testIngester({
			speechDetector: detector,
		});
		const internals = ingester as unknown as {
			sttStream: ISttStream;
			handleDecodedAudio(audio: Buffer): void;
			runVadCheck(): Promise<void>;
		};
		internals.sttStream = stream;
		const audio = Array.from({ length: 12 }, (_, index) =>
			silenceFrame(index + 1),
		);
		internals.handleDecodedAudio(Buffer.concat(audio));
		await internals.runVadCheck();
		expect(
			Buffer.concat(stream.sendAudio.mock.calls.map(([frame]) => frame)),
		).toEqual(Buffer.concat(audio));
		expect(stream.markFinal).toHaveBeenCalledExactlyOnceWith(1200);
	});

	it.each([
		undefined,
		'1000',
		'300',
		'0',
	])('preserves bounded soft-onset audio with late detector decisions and pre-roll override %s', async (override) => {
		vi.stubEnv('STT_PRE_ROLL_MS', override);
		let calls = 0;
		const detector: SpeechDetector = {
			mode: 'test',
			reset: vi.fn(),
			detect: async () => ({ speech: ++calls > 19 }),
		};
		const stream = testStream();
		const ingester = testIngester({
			speechDetector: detector,
		});
		const internals = ingester as unknown as {
			sttStream: ISttStream;
			handleDecodedAudio(audio: Buffer): void;
			runVadCheck(): Promise<void>;
		};
		internals.sttStream = stream;
		const softPrefix = Array.from({ length: 19 }, (_, index) => {
			const frame = Buffer.alloc(FRAME_BYTES);
			for (let offset = 0; offset < frame.length; offset += 2)
				frame.writeInt16LE(20 + index, offset);
			return frame;
		});
		const positiveFrame = speechFrame();
		internals.handleDecodedAudio(Buffer.concat([...softPrefix, positiveFrame, positiveFrame]));
		await internals.runVadCheck();
		const expectedPrefix =
			override === undefined
				? softPrefix
				: override === '1000'
					? softPrefix.slice(-10)
					: override === '300'
						? softPrefix.slice(-3)
						: [];
		expect(
			Buffer.concat(stream.sendAudio.mock.calls.map(([frame]) => frame)),
		).toEqual(Buffer.concat([...expectedPrefix, positiveFrame, positiveFrame]));
		expect(stream.markFinal).not.toHaveBeenCalled();
	});

	it('does not send a stale speech decision after stop during inference', async () => {
		let finish: (value: { speech: boolean }) => void = () => {};
		const detector: SpeechDetector = {
			mode: 'test',
			reset: vi.fn(),
			detect: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		};
		const stream = testStream();
		const ingester = testIngester({
			speechDetector: detector,
		});
		const internals = ingester as unknown as {
			sttStream: ISttStream;
			handleDecodedAudio(audio: Buffer): void;
			runVadCheck(): Promise<void>;
		};
		internals.sttStream = stream;
		internals.handleDecodedAudio(speechFrame());
		const checking = internals.runVadCheck();
		await ingester.stop();
		finish({ speech: true });
		await checking;
		expect(stream.sendAudio).not.toHaveBeenCalled();
		expect(stream.markFinal).not.toHaveBeenCalled();
	});

	it('reports an inference failure once and stops retrying frames at the polling cadence', async () => {
		vi.useFakeTimers();
		const failed = vi.fn();
		const detector: SpeechDetector = {
			mode: 'test',
			reset: vi.fn(),
			detect: vi.fn().mockRejectedValue(new Error('fixture inference failure')),
		};
		const stream = testStream();
		const ingester = testIngester({
			speechDetector: detector,
			onUnexpectedStreamClose: failed,
		});
		const internals = ingester as unknown as {
			running: boolean;
			sttStream: ISttStream;
			handleDecodedAudio(audio: Buffer): void;
			startVadLoop(): void;
		};
		internals.running = true;
		internals.sttStream = stream;
		internals.handleDecodedAudio(speechFrame());
		internals.startVadLoop();
		await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
		vi.advanceTimersByTime(1000);
		expect(detector.detect).toHaveBeenCalledOnce();
		expect(stream.sendAudio).not.toHaveBeenCalled();
		await ingester.stop();
	});

	it('ignores a cancelled detector load without resetting a later started stream', async () => {
		let finish: (detector: SpeechDetector) => void = () => {};
		const stale: SpeechDetector = {
			mode: 'test',
			reset: vi.fn(),
			detect: async () => ({ speech: false }),
		};
		const current: SpeechDetector = {
			mode: 'test',
			reset: vi.fn(),
			detect: async () => ({ speech: false }),
		};
		vi.spyOn(detectorModule, 'createSpeechDetector')
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValue(current);
		const stream = testStream();
		const ingester = testIngester({
			speechDetector: undefined,
			sttClient: {
				createStream: vi.fn().mockResolvedValue(stream),
			} as unknown as ISttClient,
		});
		const transport = {
			connect: vi.fn().mockResolvedValue(undefined),
			close: vi.fn(),
		};
		const internals = ingester as unknown as {
			setupPlainTransport(): Promise<void>;
			createConsumer(): Promise<void>;
			startFfmpeg(): Promise<void>;
			plainTransport: typeof transport | null;
		};
		vi.spyOn(internals, 'setupPlainTransport').mockImplementation(async () => {
			internals.plainTransport = transport;
		});
		vi.spyOn(internals, 'createConsumer').mockResolvedValue();
		vi.spyOn(internals, 'startFfmpeg').mockResolvedValue();
		const cancelled = ingester.start();
		await ingester.stop();
		await ingester.start();
		finish(stale);
		await cancelled;
		expect(stale.reset).not.toHaveBeenCalled();
		expect(current.reset).toHaveBeenCalledOnce();
		expect(stream.close).not.toHaveBeenCalled();
		await ingester.stop();
	});

	it('fences superseded stream transcripts while retaining final events during normal close', async () => {
		const callbacks: Parameters<ISttClient['createStream']>[1][] = [];
		const event = (text: string, isFinal = false) => ({
			text,
			isFinal,
			durationMs: 200,
			sequence: 1,
		});
		let finish: (stream: ISttStream) => void = () => {};
		const stale = {
			sendAudio: vi.fn(() => true),
			markFinal: vi.fn(),
			onUnexpectedClose: vi.fn(),
			close: vi.fn(async () => {
				callbacks[0](event('stale final', true));
			}),
		} satisfies ISttStream;
		const current = {
			sendAudio: vi.fn(() => true),
			markFinal: vi.fn(),
			onUnexpectedClose: vi.fn(),
			close: vi.fn(async () => {
				callbacks[1](event('current final', true));
			}),
		} satisfies ISttStream;
		const createStream = vi
			.fn<ISttClient['createStream']>()
			.mockImplementationOnce((_metadata, callback) => {
				callbacks.push(callback);
				return new Promise((resolve) => {
					finish = resolve;
				});
			})
			.mockImplementationOnce(async (_metadata, callback) => {
				callbacks.push(callback);
				return current;
			});
		const onTranscript = vi.fn();
		const ingester = testIngester({
			sttClient: { createStream } as unknown as ISttClient,
			onTranscript,
		});
		const transport = {
			connect: vi.fn().mockResolvedValue(undefined),
			close: vi.fn(),
		};
		const internals = ingester as unknown as {
			setupPlainTransport(): Promise<void>;
			createConsumer(): Promise<void>;
			startFfmpeg(): Promise<void>;
			plainTransport: typeof transport | null;
		};
		vi.spyOn(internals, 'setupPlainTransport').mockImplementation(async () => {
			internals.plainTransport = transport;
		});
		vi.spyOn(internals, 'createConsumer').mockResolvedValue();
		vi.spyOn(internals, 'startFfmpeg').mockResolvedValue();
		const cancelled = ingester.start();
		await vi.waitFor(() => expect(createStream).toHaveBeenCalledTimes(1));
		await ingester.stop();
		await ingester.start();
		callbacks[0](event('stale draft'));
		finish(stale);
		await cancelled;
		expect(onTranscript).not.toHaveBeenCalled();
		callbacks[1](event('current draft'));
		await ingester.stop();
		expect(onTranscript.mock.calls).toEqual([
			['current draft', false, 200],
			['current final', true, 200],
		]);
		callbacks[1](event('after close', true));
		expect(onTranscript).toHaveBeenCalledTimes(2);
	});

	it('expires quiet-only pre-roll and detector context once after a long PCM gap', async () => {
		vi.useFakeTimers();
		const detector = fixtureDetector();
		const stream = testStream();
		const ingester = testIngester({
			speechDetector: detector,
		});
		const internals = ingester as unknown as {
			sttStream: ISttStream;
			handleDecodedAudio(data: Buffer): void;
			runVadCheck(): Promise<void>;
		};
		internals.sttStream = stream;
		internals.handleDecodedAudio(silenceFrame(45));
		await internals.runVadCheck();
		vi.advanceTimersByTime(699);
		await internals.runVadCheck();
		expect(detector.reset).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		await internals.runVadCheck();
		await internals.runVadCheck();
		expect(detector.reset).toHaveBeenCalledOnce();
		internals.handleDecodedAudio(speechFrame());
		internals.handleDecodedAudio(speechFrame());
		await internals.runVadCheck();
		expect(
			Buffer.concat(stream.sendAudio.mock.calls.map(([frame]) => frame)),
		).toEqual(Buffer.concat([speechFrame(), speechFrame()]));
		for (let index = 0; index < 7; index++)
			internals.handleDecodedAudio(silenceFrame());
		await internals.runVadCheck();
		expect(stream.markFinal).toHaveBeenCalledExactlyOnceWith(900);
		stream.sendAudio.mockClear();
		internals.handleDecodedAudio(silenceFrame(123));
		await internals.runVadCheck();
		vi.advanceTimersByTime(699);
		await internals.runVadCheck();
		expect(detector.reset).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(1);
		await internals.runVadCheck();
		expect(detector.reset).toHaveBeenCalledTimes(2);
		internals.handleDecodedAudio(speechFrame());
		internals.handleDecodedAudio(speechFrame());
		await internals.runVadCheck();
		expect(
			Buffer.concat(stream.sendAudio.mock.calls.map(([frame]) => frame)),
		).toEqual(Buffer.concat([speechFrame(), speechFrame()]));
	});

	it.each([
		false,
		true,
	])('handles a single positive block after DTX without interrupting capture, pre-roll=%s', async (withPreRoll) => {
		vi.useFakeTimers();
		const stream = testStream();
		const onFailure = vi.fn();
		const ingester = testIngester({
			onUnexpectedStreamClose: onFailure,
		});
		const internals = ingester as unknown as {
			running: boolean;
			sttStream: ISttStream;
			handleDecodedAudio(data: Buffer): void;
			runVadCheck(): Promise<void>;
		};
		internals.running = true;
		internals.sttStream = stream;
		if (withPreRoll) internals.handleDecodedAudio(silenceFrame(32));
		internals.handleDecodedAudio(speechFrame());
		await internals.runVadCheck();
		vi.advanceTimersByTime(699);
		await internals.runVadCheck();
		expect(stream.markFinal).not.toHaveBeenCalled();
		expect(stream.close).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		await internals.runVadCheck();
		if (withPreRoll) {
			expect(stream.markFinal).toHaveBeenCalledExactlyOnceWith(200);
			expect(stream.close).not.toHaveBeenCalled();
			expect(onFailure).not.toHaveBeenCalled();
			stream.sendAudio.mockClear();
			internals.handleDecodedAudio(speechFrame());
			internals.handleDecodedAudio(speechFrame());
			await internals.runVadCheck();
			expect(stream.sendAudio).toHaveBeenCalledTimes(2);
			await ingester.stop();
		} else {
			expect(stream.markFinal).not.toHaveBeenCalled();
			expect(stream.sendAudio).not.toHaveBeenCalled();
			expect(stream.close).not.toHaveBeenCalled();
			expect(onFailure).not.toHaveBeenCalled();
			// Subsequent speech uses the same stream and contains no old fragment.
			const nextSpeech = Buffer.from(speechFrame());
			nextSpeech.writeInt16LE(123, 2);
			internals.handleDecodedAudio(Buffer.concat([nextSpeech, nextSpeech]));
			await internals.runVadCheck();
			vi.advanceTimersByTime(700);
			await internals.runVadCheck();
			expect(
				Buffer.concat(stream.sendAudio.mock.calls.map(([frame]) => frame)),
			).toEqual(Buffer.concat([nextSpeech, nextSpeech]));
			expect(stream.markFinal).toHaveBeenCalledExactlyOnceWith(200);
			expect(stream.close).not.toHaveBeenCalled();
			expect(onFailure).not.toHaveBeenCalled();
			await ingester.stop();
		}
	});

	it('drains queued VAD frames with explicit 300 ms pre-roll ordering', async () => {
		vi.stubEnv('STT_PRE_ROLL_MS', '300');
		const onAudioSent = vi.fn();
		const stream = testStream();
		const sttClient = {
			isAvailable: () => true,
			onAvailable: vi.fn(),
			createStream: vi.fn(),
		} satisfies ISttClient;
		const ingester = testIngester({
			sttClient,
			onAudioSent,
		});
		const silences = Array.from({ length: 5 }, (_, index) =>
			silenceFrame(index + 1),
		);
		const speech1 = speechFrame();
		const speechSilence = silenceFrame();
		const speech2 = speechFrame();
		const remainder = Buffer.alloc(FRAME_BYTES / 2);
		const internals = ingester as unknown as {
			handleDecodedAudio(audio: Buffer): void;
			sttStream: ISttStream;
			runVadCheck(): Promise<void>;
		};
		internals.handleDecodedAudio(
			Buffer.concat([...silences, speech1, speechSilence, speech2, remainder]),
		);
		internals.sttStream = stream;

		await internals.runVadCheck();

		expect(stream.sendAudio.mock.calls.map(([frame]) => frame)).toEqual([
			...silences.slice(-3),
			speech1,
			speechSilence,
			speech2,
		]);
		expect(stream.markFinal).not.toHaveBeenCalled();
		expect(onAudioSent).toHaveBeenCalledTimes(6);
		expect(
			onAudioSent.mock.calls.reduce((sum, [seconds]) => sum + seconds, 0),
		).toBeCloseTo(0.6);
		stream.sendAudio.mockReturnValueOnce(false);
		internals.handleDecodedAudio(speechFrame());
		await internals.runVadCheck();
		expect(onAudioSent).toHaveBeenCalledTimes(6);
	});

	it('commits DTX inactivity before teardown, retains a real partial tail, and starts fresh on resumed speech', async () => {
		vi.useFakeTimers();
		const stream = testStream();
		const ingester = testIngester();
		const internals = ingester as unknown as {
			sttStream: ISttStream;
			handleDecodedAudio(data: Buffer): void;
			runVadCheck(): Promise<void>;
		};
		internals.sttStream = stream;
		for (let frame = 0; frame < 6; frame++) {
			internals.handleDecodedAudio(speechFrame());
			await internals.runVadCheck();
			vi.advanceTimersByTime(100);
			expect(stream.markFinal).not.toHaveBeenCalled();
		}
		const realTail = speechFrame().subarray(0, FRAME_BYTES / 2);
		internals.handleDecodedAudio(realTail);
		await internals.runVadCheck();
		vi.advanceTimersByTime(499);
		await internals.runVadCheck();
		expect(stream.markFinal).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		await internals.runVadCheck();
		expect(stream.markFinal).toHaveBeenCalledExactlyOnceWith(650);
		expect(
			Buffer.concat(stream.sendAudio.mock.calls.map(([frame]) => frame)),
		).toEqual(
			Buffer.concat([...Array.from({ length: 6 }, speechFrame), realTail]),
		);
		stream.sendAudio.mockClear();
		internals.handleDecodedAudio(speechFrame());
		internals.handleDecodedAudio(speechFrame());
		await internals.runVadCheck();
		vi.advanceTimersByTime(699);
		await internals.runVadCheck();
		expect(stream.markFinal).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1);
		await internals.runVadCheck();
		expect(stream.markFinal.mock.calls).toEqual([[650], [200]]);
		expect(stream.sendAudio).toHaveBeenCalledTimes(2);
	});

	it('finalizes continuous speech at the maximum utterance duration', async () => {
		const stream = testStream();
		const ingester = testIngester();
		const internals = ingester as unknown as {
			handleDecodedAudio(audio: Buffer): void;
			sttStream: ISttStream;
			runVadCheck(): Promise<void>;
		};
		internals.sttStream = stream;
		for (let index = 0; index < 151; index++) {
			internals.handleDecodedAudio(speechFrame());
			await internals.runVadCheck();
		}

		expect(stream.markFinal).toHaveBeenCalledOnce();
		expect(stream.markFinal).toHaveBeenCalledWith(15_000);
	});

	it('reports FFmpeg failure once and suppresses exit during normal stop', async () => {
		const onFailure = vi.fn();
		const ingester = testIngester({
			onUnexpectedStreamClose: onFailure,
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
