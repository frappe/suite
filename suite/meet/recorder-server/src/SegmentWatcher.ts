import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readdir, rename, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { CaptureSegment, MediaTools } from './captureTypes.js';
import type { ManifestStore } from './ManifestStore.js';

export class SegmentWatcher {
	private timer?: NodeJS.Timeout;
	private adopted = new Set<string>();
	private scans: Promise<void> = Promise.resolve();
	constructor(
		private readonly store: ManifestStore,
		private readonly tools: MediaTools,
		private readonly epoch: number,
		private readonly intervalMs = 250,
		private readonly onAdopt?: (
			segment: CaptureSegment,
		) => void | Promise<void>,
	) {}
	start(): void {
		this.timer = setInterval(() => {
			this.scan(false).catch(() => undefined);
		}, this.intervalMs);
	}
	async stopAndAdoptFinal(): Promise<'adopted' | 'skipped' | 'quarantined'> {
		if (this.timer) clearInterval(this.timer);
		const before = this.store.get().segments.length;
		try {
			await this.scan(true);
			return this.store.get().segments.length > before ? 'adopted' : 'skipped';
		} catch (error) {
			await this.recordInvalidFinal(error);
			return 'quarantined';
		}
	}
	async scan(includeFinal: boolean): Promise<void> {
		const scan = this.scans
			.catch(() => undefined)
			.then(() => this.scanOnce(includeFinal));
		this.scans = scan;
		return scan;
	}
	private async scanOnce(includeFinal: boolean): Promise<void> {
		const prefix = `epoch-${String(this.epoch).padStart(3, '0')}-segment-`;
		const files = (await readdir(this.store.directory))
			.filter(
				(x) =>
					x.startsWith(prefix) && /^epoch-\d{3}-segment-\d{6}\.ts$/.test(x),
			)
			.sort();
		const candidates = includeFinal ? files : files.slice(0, -1);
		for (const file of candidates) {
			if (
				this.adopted.has(file) ||
				this.store.get().segments.some((s) => s.file === file)
			) {
				this.adopted.add(file);
				continue;
			}
			const path = await this.store.resolveFile(file);
			const probe = await this.tools.validate(path);
			const handle = await open(path, 'r');
			try {
				await handle.sync();
			} finally {
				await handle.close();
			}
			const info = await stat(path);
			const hash = createHash('sha256');
			for await (const chunk of createReadStream(path)) hash.update(chunk);
			const segment: CaptureSegment = {
				epoch: this.epoch,
				index: this.store.get().segments.length,
				file: basename(path),
				bytes: info.size,
				sha256: hash.digest('hex'),
				duration_ms: probe.duration_ms,
				started_at: info.birthtime.toISOString(),
			};
			await this.store.update((m) => {
				if (m.segments.some((s) => s.file === file)) return;
				segment.index = m.segments.length;
				m.segments.push(segment);
			});
			this.adopted.add(file);
			await this.onAdopt?.(segment);
		}
	}
	private async recordInvalidFinal(error: unknown): Promise<void> {
		const prefix = `epoch-${String(this.epoch).padStart(3, '0')}-segment-`;
		const file = (await readdir(this.store.directory))
			.filter((x) => x.startsWith(prefix) && x.endsWith('.ts'))
			.sort()
			.at(-1);
		if (file) {
			const source = join(this.store.directory, file);
			await rename(source, `${source}.invalid`).catch(() => undefined);
		}
		await this.store.update((m) => {
			m.gaps.push({
				started_at: new Date().toISOString(),
				reason:
					`invalid_final_segment:${error instanceof Error ? error.message : 'validation_failed'}`.slice(
						0,
						256,
					),
			});
		});
	}
}
