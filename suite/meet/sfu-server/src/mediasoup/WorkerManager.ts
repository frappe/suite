import * as mediasoup from 'mediasoup';
import type { WebRTCServerOptions, WorkerSettings } from '../types';
import { loggers } from '../utils/logger';
import { captureException, flushSentry } from '../utils/sentry';

export interface WorkerEntry {
	id: number;
	worker: mediasoup.types.Worker;
	webRtcServer: mediasoup.types.WebRtcServer;
}

export class WorkerManager {
	private workers: WorkerEntry[] = [];
	private nextWorkerIndex = 0;

	async initialize(
		numWorkers: number,
		workerSettings: WorkerSettings,
		webRtcServerOptions: WebRTCServerOptions,
	): Promise<void> {
		loggers.workerManager.info('Initializing Mediasoup workers');

		for (let i = 0; i < numWorkers; i++) {
			const worker = await mediasoup.createWorker(workerSettings);

			worker.on('died', () => {
				const workerDeath = new Error(`Mediasoup worker ${i + 1} died`);
				loggers.workerManager.error(
					'Mediasoup worker %d died, initiating cleanup and restart',
					i + 1,
				);
				captureException(workerDeath);

				this.cleanup()
					.then(async () => {
						loggers.workerManager.info('Cleanup completed, restarting process');
						await flushSentry();
						setTimeout(() => process.exit(1), 2000);
					})
					.catch(async (error) => {
						loggers.workerManager.error(
							'Error during cleanup after worker death: %s',
							(error as Error).message,
						);
						captureException(error);
						await flushSentry();
						setTimeout(() => process.exit(1), 1000);
					});
			});

			const webRtcServer = await worker.createWebRtcServer({
				listenInfos: [
					{
						protocol: 'udp',
						ip: webRtcServerOptions.listenIp,
						announcedAddress: webRtcServerOptions.announcedAddress,
						port: webRtcServerOptions.basePort + i,
					},
				],
			});

			this.workers.push({ id: i + 1, worker, webRtcServer });
			loggers.workerManager.info(
				'Created worker %d/%d with WebRtcServer on UDP port %d',
				i + 1,
				numWorkers,
				webRtcServerOptions.basePort + i,
			);
		}

		loggers.workerManager.info('Mediasoup workers initialized successfully');
	}

	getNextWorker(): WorkerEntry {
		return this.getNextWorkers(1)[0];
	}

	getNextWorkers(count: number): WorkerEntry[] {
		if (count < 1 || count > this.workers.length) {
			throw new Error(
				`Requested ${count} mediasoup workers, but ${this.workers.length} are available`,
			);
		}
		const selected = Array.from(
			{ length: count },
			(_, index) =>
				this.workers[(this.nextWorkerIndex + index) % this.workers.length],
		);
		// Rotate the primary worker for each room while preserving the remaining
		// workers as that room's ordered spill candidates.
		this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
		return selected;
	}

	getAllWorkers(): WorkerEntry[] {
		return this.workers;
	}

	async cleanup(): Promise<void> {
		loggers.workerManager.info('Closing %d workers', this.workers.length);
		for (const { worker, webRtcServer } of this.workers) {
			try {
				webRtcServer.close();
				worker.close();
			} catch (error) {
				loggers.workerManager.warn(
					'Error closing worker: %s',
					(error as Error).message,
				);
			}
		}
		this.workers = [];
		this.nextWorkerIndex = 0;
	}
}
