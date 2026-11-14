import type { SpeechDetector } from '../stt/SpeechDetector';

/** Bounded speech spans on the decoded sample clock, with real pre-roll and tail. */
export class SpeechSegmenter {
	private pending = Buffer.alloc(0);
	private pendingStart = 0;
	private preRoll: Array<{ audio: Buffer; start: number }> = [];
	private frames: Buffer[] = [];
	private start = 0;
	private bytes = 0;
	private silence = 0;
	constructor(
		private readonly detector: SpeechDetector,
		private readonly emit: (audio: Buffer, start: number, end: number) => void,
	) {}
	async push(pcm: Buffer, startMs: number): Promise<void> {
		if (
			this.pending.length &&
			Math.abs(startMs - (this.pendingStart + this.pending.length / 48)) > 1
		)
			await this.finishSpan();
		if (!this.pending.length) this.pendingStart = startMs;
		this.pending = Buffer.concat([this.pending, pcm]);
		while (this.pending.length >= 4800) {
			const frame = this.pending.subarray(0, 4800);
			const start = this.pendingStart;
			this.pending = this.pending.subarray(4800);
			this.pendingStart += 100;
			await this.frame(frame, start);
		}
	}
	private async frame(audio: Buffer, start: number): Promise<void> {
		const { speech } = await this.detector.detect(audio);
		if (speech) {
			if (!this.bytes) {
				for (const pre of this.preRoll) this.append(pre.audio, pre.start);
				this.preRoll = [];
			}
			this.silence = 0;
			this.append(audio, start);
		} else if (this.bytes) {
			this.append(audio, start);
			this.silence++;
			// Near the 15-second cap, take a detected pause before the next word
			// starts. Preserve its audio; a hard cut remains the bounded fallback.
			if (this.silence >= 5 || this.bytes >= 13 * 24000 * 2) this.flush();
		} else {
			this.preRoll.push({ audio: Buffer.from(audio), start });
			if (this.preRoll.length > 20) this.preRoll.shift();
		}
	}
	private append(audio: Buffer, start: number): void {
		if (!this.bytes) this.start = start;
		this.frames.push(Buffer.from(audio));
		this.bytes += audio.length;
		if (this.bytes >= 720000) this.flush();
	}
	private flush(): void {
		if (this.bytes)
			this.emit(
				Buffer.concat(this.frames, this.bytes),
				this.start,
				this.start + this.bytes / 48,
			);
		this.frames = [];
		this.bytes = 0;
		this.silence = 0;
	}
	async finishSpan(): Promise<void> {
		if (this.pending.length) {
			const frame = this.pending;
			const start = this.pendingStart;
			this.pending = Buffer.alloc(0);
			await this.frame(frame, start);
		}
		this.flush();
		this.preRoll = [];
		this.detector.reset();
	}
}
