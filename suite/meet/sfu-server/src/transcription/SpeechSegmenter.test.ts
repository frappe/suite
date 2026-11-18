import { describe, expect, it } from 'vitest';
import type { SpeechDetector } from '../stt/SpeechDetector';
import { SpeechSegmenter } from './SpeechSegmenter';

function frame(value: number): Buffer {
	const data = Buffer.alloc(4800);
	for (let i = 0; i < data.length; i += 2) data.writeInt16LE(value, i);
	return data;
}
function detector(): SpeechDetector {
	return {
		mode: 'fixture',
		reset() {},
		async detect(audio) {
			return { speech: audio.readInt16LE(0) === 1000 };
		},
	};
}

describe('durable speech segmentation', () => {
	it('ends a long span at a detected pause before the hard limit without losing audio', async () => {
		const output: Array<{ audio: Buffer; start: number; end: number }> = [];
		const segmenter = new SpeechSegmenter(detector(), (audio, start, end) =>
			output.push({ audio, start, end }),
		);
		const frames = [
			...Array.from({ length: 140 }, () => frame(1000)),
			frame(0),
			...Array.from({ length: 20 }, () => frame(1000)),
		];
		for (const [index, audio] of frames.entries())
			await segmenter.push(audio, index * 100);
		await segmenter.finishSpan();
		expect(output.map(({ start, end }) => [start, end])).toEqual([
			[0, 14_100],
			[14_100, 16_100],
		]);
		expect(Buffer.concat(output.map(({ audio }) => audio))).toEqual(
			Buffer.concat(frames),
		);
	});
	it('saves actual two-second pre-roll, speech and half-second tail on their capture timeline', async () => {
		const emitted: Array<{ pcm: Buffer; start: number; end: number }> = [];
		const segmenter = new SpeechSegmenter(detector(), (pcm, start, end) =>
			emitted.push({ pcm, start, end }),
		);
		for (let i = 0; i < 30; i++)
			await segmenter.push(frame(i < 25 ? 0 : 1000), 1000 + i * 100);
		for (let i = 0; i < 5; i++) await segmenter.push(frame(0), 4000 + i * 100);
		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.start).toBe(1500);
		expect(emitted[0]?.end).toBe(4500);
		expect(emitted[0]?.pcm.length).toBe(144000);
		expect(emitted[0]?.pcm.subarray(96000, 120000)).toEqual(
			Buffer.concat(Array.from({ length: 5 }, () => frame(1000))),
		);
	});
	it('emits no silence and does not compress DTX pauses or lose a short final utterance', async () => {
		const spans: Array<[number, number]> = [];
		const segmenter = new SpeechSegmenter(detector(), (_audio, start, end) =>
			spans.push([start, end]),
		);
		await segmenter.push(frame(0), 0);
		await segmenter.finishSpan();
		expect(spans).toEqual([]);
		await segmenter.push(frame(1000), 1000);
		await segmenter.finishSpan();
		await segmenter.push(frame(1000), 5000);
		await segmenter.finishSpan();
		expect(spans).toEqual([
			[1000, 1100],
			[5000, 5100],
		]);
	});
	it('bounds continuous speech and preserves audio despite arbitrary decoder chunk boundaries', async () => {
		const output: Buffer[] = [];
		const times: Array<[number, number]> = [];
		const segmenter = new SpeechSegmenter(detector(), (audio, start, end) => {
			output.push(audio);
			times.push([start, end]);
		});
		const audio = Buffer.concat(Array.from({ length: 151 }, () => frame(1000)));
		await segmenter.push(audio.subarray(0, 101), 2000);
		await segmenter.push(audio.subarray(101), 2000 + 101 / 48);
		await segmenter.finishSpan();
		expect(times).toEqual([
			[2000, 17000],
			[17000, 17100],
		]);
		expect(Buffer.concat(output)).toEqual(audio);
	});
});
