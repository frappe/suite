import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-node';

export const SILERO_REVISION = '1e261b036686cd0017d500ee96acd1c4ba572a9d';
export const SILERO_SHA256 =
	'1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3';
const sourceModelPath = path.resolve(
	__dirname,
	'../../assets/silero-vad/silero_vad.onnx',
);
const MODEL_PATH = fs.existsSync(sourceModelPath)
	? sourceModelPath
	: path.resolve(__dirname, '../../../../assets/silero-vad/silero_vad.onnx');
const FRAME_SAMPLES = 512;
const CONTEXT_SAMPLES = 64;
const START_PROBABILITY = 0.5;
const CONTINUE_PROBABILITY = 0.35;

export interface SpeechDecision {
	speech: boolean;
	probability?: number;
}
export interface SpeechDetector {
	readonly mode: string;
	detect(pcm24k: Buffer): Promise<SpeechDecision>;
	reset(): void;
}

/** Causal 24→16 kHz low-pass FIR; only the detector sees this audio. */
export class VadResampler {
	private history = new Float64Array(64);
	private inputCount = 0;
	private outputCount = 0;
	private static kernels = [0, 0.5].map((fraction) => {
		const taps = Array.from({ length: 63 }, (_, index) => {
			const position = index - 31 + fraction;
			const cutoff = 7200 / 24000;
			const sinc =
				position === 0
					? 2 * cutoff
					: Math.sin(2 * Math.PI * cutoff * position) / (Math.PI * position);
			const window =
				0.42 -
				0.5 * Math.cos((2 * Math.PI * index) / 62) +
				0.08 * Math.cos((4 * Math.PI * index) / 62);
			return sinc * window;
		});
		const sum = taps.reduce((total, value) => total + value, 0);
		return taps.map((value) => value / sum);
	});

	process(input: Float32Array): Float32Array {
		const output: number[] = [];
		for (const sample of input) {
			const index = this.inputCount++;
			this.history[index % this.history.length] = sample;
			while (Math.floor((this.outputCount * 3) / 2) <= index) {
				const source = Math.floor((this.outputCount * 3) / 2);
				const taps = VadResampler.kernels[this.outputCount % 2];
				let value = 0;
				for (let tap = 0; tap < taps.length; tap++) {
					if (source >= tap)
						value +=
							taps[tap] * this.history[(source - tap) % this.history.length];
				}
				output.push(value);
				this.outputCount++;
			}
		}
		return Float32Array.from(output);
	}
	reset(): void {
		this.history.fill(0);
		this.inputCount = 0;
		this.outputCount = 0;
	}
}

let sharedSession: Promise<ort.InferenceSession> | undefined;
let runtimeFailure: Error | undefined;
async function session(): Promise<ort.InferenceSession> {
	if (runtimeFailure) throw runtimeFailure;
	sharedSession ??= (async () => {
		const model = await fs.promises.readFile(MODEL_PATH);
		if (createHash('sha256').update(model).digest('hex') !== SILERO_SHA256)
			throw new Error('Silero VAD model checksum mismatch');
		return ort.InferenceSession.create(model, {
			executionProviders: ['cpu'],
			intraOpNumThreads: 1,
			interOpNumThreads: 1,
		});
	})();
	return sharedSession;
}

/** Load the shared CPU model without creating a producer or processing audio. */
export async function preloadSpeechDetector(): Promise<void> {
	await session();
}

/** Model/session are shared; all streaming state belongs to this producer. */
export class SileroSpeechDetector implements SpeechDetector {
	readonly mode = 'silero';
	private resampler = new VadResampler();
	private state = new Float32Array(256);
	private context = new Float32Array(CONTEXT_SAMPLES);
	private pending = new Float32Array(0);
	private active = false;
	private generation = 0;
	private processing = Promise.resolve();
	private constructor(private model: ort.InferenceSession) {}
	static async create(): Promise<SileroSpeechDetector> {
		return new SileroSpeechDetector(await session());
	}

	detect(audio: Buffer): Promise<SpeechDecision> {
		const generation = this.generation;
		const result = this.processing.then(() =>
			generation === this.generation
				? this.process(audio, generation)
				: { speech: false },
		);
		this.processing = result.then(
			() => {},
			() => {},
		);
		return result;
	}
	private async process(
		audio: Buffer,
		generation: number,
	): Promise<SpeechDecision> {
		if (!audio.length || audio.length % 2)
			throw new Error('VAD needs complete PCM16 samples');
		const samples = new Float32Array(audio.length / 2);
		for (let index = 0; index < samples.length; index++)
			samples[index] = audio.readInt16LE(index * 2) / 32768;
		const resampled = this.resampler.process(samples);
		const input = new Float32Array(this.pending.length + resampled.length);
		input.set(this.pending);
		input.set(resampled, this.pending.length);
		let speech = false;
		let probability = 0;
		let offset = 0;
		try {
			for (; offset + FRAME_SAMPLES <= input.length; offset += FRAME_SAMPLES) {
				const frame = input.subarray(offset, offset + FRAME_SAMPLES);
				const modelInput = new Float32Array(CONTEXT_SAMPLES + FRAME_SAMPLES);
				modelInput.set(this.context);
				modelInput.set(frame, CONTEXT_SAMPLES);
				const output = await this.model.run({
					input: new ort.Tensor('float32', modelInput, [1, modelInput.length]),
					state: new ort.Tensor('float32', this.state, [2, 1, 128]),
					sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), []),
				});
				if (generation !== this.generation) return { speech: false };
				const value = Number(output.output.data[0]);
				if (
					!Number.isFinite(value) ||
					value < 0 ||
					value > 1 ||
					output.stateN.type !== 'float32' ||
					output.stateN.data.length !== 256
				)
					throw new Error('Invalid Silero VAD output');
				this.state = Float32Array.from(output.stateN.data as Float32Array);
				this.context = Float32Array.from(
					frame.subarray(FRAME_SAMPLES - CONTEXT_SAMPLES),
				);
				this.active =
					value >= (this.active ? CONTINUE_PROBABILITY : START_PROBABILITY);
				speech ||= this.active;
				probability = Math.max(probability, value);
			}
		} catch {
			if (generation !== this.generation) return { speech: false };
			// Subsequent ingester setup fails synchronously through normal recovery
			// backoff, rather than restarting a broken inference loop at audio rate.
			runtimeFailure ??= new Error(
				'Silero VAD inference failed; restart the SFU after correcting the runtime',
			);
			throw runtimeFailure;
		}
		this.pending = input.slice(offset);
		return { speech, probability };
	}
	reset(): void {
		this.generation++;
		this.state = new Float32Array(256);
		this.context = new Float32Array(CONTEXT_SAMPLES);
		this.pending = new Float32Array(0);
		this.active = false;
		this.resampler.reset();
	}
}

export async function createSpeechDetector(): Promise<SpeechDetector> {
	return SileroSpeechDetector.create();
}
