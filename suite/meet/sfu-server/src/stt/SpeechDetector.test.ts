import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	createSpeechDetector,
	preloadSpeechDetector,
	SileroSpeechDetector,
	VadResampler,
} from './SpeechDetector';

function sine(frequency: number): Float32Array {
	return Float32Array.from(
		{ length: 24_000 },
		(_, index) => 0.8 * Math.sin((2 * Math.PI * frequency * index) / 24_000),
	);
}
function rms(samples: Float32Array): number {
	return Math.sqrt(
		samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
	);
}

describe('VAD-only streaming resampling', () => {
	it('preserves in-band sine amplitude and suppresses frequencies which would alias', () => {
		const voiceBand = new VadResampler().process(sine(2000));
		const aboveNyquist = new VadResampler().process(sine(10_000));
		expect(voiceBand).toHaveLength(16_000);
		expect(rms(voiceBand.subarray(1600))).toBeCloseTo(0.8 / Math.sqrt(2), 2);
		expect(rms(aboveNyquist.subarray(1600))).toBeLessThan(0.006);
	});
	it('produces identical samples across arbitrary packet boundaries and resets cleanly', () => {
		const source = sine(1750);
		const expected = new VadResampler().process(source);
		const split = new VadResampler();
		const pieces: number[] = [];
		let offset = 0;
		for (const length of [1, 17, 2400, 319, 777, 20486]) {
			pieces.push(...split.process(source.subarray(offset, offset + length)));
			offset += length;
		}
		expect(Float32Array.from(pieces)).toEqual(expected);
		split.reset();
		expect(split.process(source)).toEqual(expected);
	});
});

describe('packaged CPU speech detector', () => {
	it('rejects digital silence after preload with separate producer state and repeatable reset', async () => {
		await preloadSpeechDetector();
		const first = await createSpeechDetector();
		expect(first.mode).toBe('silero');
		const second = await SileroSpeechDetector.create();
		const initial = await first.detect(Buffer.alloc(4800));
		expect(initial.speech).toBe(false);
		expect(initial.probability).toBeLessThan(0.5);
		await first.detect(Buffer.alloc(4800));
		expect(await second.detect(Buffer.alloc(4800))).toEqual(initial);
		first.reset();
		expect(await first.detect(Buffer.alloc(4800))).toEqual(initial);
	});
	it.runIf(Boolean(process.env.STT_VAD_TEST_PCM))(
		'retains independently identified quiet speech from a private captured fixture',
		async () => {
			const pcm = fs.readFileSync(process.env.STT_VAD_TEST_PCM!);
			const detector = await SileroSpeechDetector.create();
			let speechFrames = 0;
			for (let offset = 0; offset < pcm.length; offset += 4800) {
				if ((await detector.detect(pcm.subarray(offset, offset + 4800))).speech)
					speechFrames++;
			}
			expect(speechFrames).toBeGreaterThan(20);
		},
	);
});
