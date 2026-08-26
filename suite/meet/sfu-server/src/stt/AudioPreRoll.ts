export class AudioPreRoll {
	private frames: Buffer[] = [];

	constructor(private maxFrames: number) {}

	remember(frame: Buffer): void {
		if (this.maxFrames === 0) return;
		this.frames.push(frame);
		if (this.frames.length > this.maxFrames) this.frames.shift();
	}

	drain(): Buffer[] {
		const frames = this.frames;
		this.frames = [];
		return frames;
	}

	clear(): void {
		this.frames = [];
	}
}
