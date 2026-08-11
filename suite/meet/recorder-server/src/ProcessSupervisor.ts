import { type SpawnOptions, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ManagedProcess {
	readonly pid: number | undefined;
	readonly exited: Promise<{
		code: number | null;
		signal: NodeJS.Signals | null;
	}>;
	stop(timeoutMs?: number): Promise<void>;
}
export type ProcessSpawner = typeof spawn;

export interface ProcessSupervisorOptions {
	maxLogBytes?: number;
	kill?: typeof process.kill;
}

export class ProcessSupervisor {
	private readonly maxLogBytes: number;
	private readonly kill: typeof process.kill;
	constructor(
		private readonly spawner: ProcessSpawner = spawn,
		options: ProcessSupervisorOptions = {},
	) {
		this.maxLogBytes = options.maxLogBytes ?? 1024 * 1024;
		this.kill = options.kill ?? process.kill;
	}

	async start(
		command: string,
		args: string[],
		options: SpawnOptions & {
			logPath: string;
			onUnexpectedExit?: (result: {
				code: number | null;
				signal: NodeJS.Signals | null;
			}) => void;
		},
	): Promise<ManagedProcess> {
		await mkdir(dirname(options.logPath), { recursive: true, mode: 0o700 });
		const log = createWriteStream(options.logPath, { flags: 'w', mode: 0o600 });
		const child = this.spawner(command, args, {
			...options,
			logPath: undefined,
			onUnexpectedExit: undefined,
			shell: false,
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		} as SpawnOptions);
		let logged = 0;
		const writeLog = (chunk: Buffer | string) => {
			if (logged >= this.maxLogBytes) return;
			const data = Buffer.from(chunk);
			const output = data.subarray(0, this.maxLogBytes - logged);
			logged += output.length;
			log.write(output);
		};
		child.stdout?.on('data', writeLog);
		child.stderr?.on('data', writeLog);
		let stopping = false;
		let stopPromise: Promise<void> | undefined;
		const exited = new Promise<{
			code: number | null;
			signal: NodeJS.Signals | null;
		}>((resolve, reject) => {
			child.once('error', reject);
			child.once('exit', (code, signal) => {
				const result = { code, signal };
				log.end();
				resolve(result);
				if (!stopping) options.onUnexpectedExit?.(result);
			});
		});
		return {
			pid: child.pid,
			exited,
			stop: (timeoutMs = 10_000) => {
				if (stopPromise) return stopPromise;
				stopPromise = (async () => {
					if (!child.pid) return;
					stopping = true;
					try {
						this.kill(-child.pid, 'SIGTERM');
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
						throw error;
					}
					let timer: NodeJS.Timeout | undefined;
					const outcome = await Promise.race([
						exited.then(() => 'exit' as const),
						new Promise<'timeout'>((resolve) => {
							timer = setTimeout(() => resolve('timeout'), timeoutMs);
						}),
					]);
					if (timer) clearTimeout(timer);
					if (outcome === 'timeout') {
						try {
							this.kill(-child.pid, 'SIGKILL');
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
							throw error;
						}
						await exited;
					}
				})();
				return stopPromise;
			},
		};
	}
}
