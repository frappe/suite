import { statfsSync } from 'node:fs';

export interface StorageGuard {
	ready(): boolean;
	canReserve(bytes: number): boolean;
}

export class DiskGuard implements StorageGuard {
	constructor(
		private readonly path: string,
		private readonly minimumFreeBytes: number,
		private readonly availableBytes: (path: string) => number = (target) => {
			const stats = statfsSync(target);
			return stats.bavail * stats.bsize;
		},
	) {}

	ready(): boolean {
		return this.freeBytes() >= this.minimumFreeBytes;
	}

	canReserve(bytes: number): boolean {
		return (
			Number.isSafeInteger(bytes) &&
			bytes > 0 &&
			this.freeBytes() - this.minimumFreeBytes >= bytes
		);
	}

	private freeBytes(): number {
		try {
			const available = this.availableBytes(this.path);
			return Number.isSafeInteger(available) && available >= 0 ? available : 0;
		} catch {
			return 0;
		}
	}
}
