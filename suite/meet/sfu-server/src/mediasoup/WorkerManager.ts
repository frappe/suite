import * as mediasoup from 'mediasoup';
import type { WebRTCServerOptions, WorkerSettings } from '../types';
import { loggers } from '../utils/logger';

interface WorkerEntry {
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
				loggers.workerManager.error(
					'Mediasoup worker %d died, initiating cleanup and restart',
					i + 1,
				);

				this.cleanup()
					.then(() => {
						loggers.workerManager.info('Cleanup completed, restarting process');
						setTimeout(() => process.exit(1), 2000);
					})
					.catch((error) => {
						loggers.workerManager.error(
							'Error during cleanup after worker death: %s',
							(error as Error).message,
						);
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

			this.workers.push({ worker, webRtcServer });
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
		const worker = this.workers[this.nextWorkerIndex];
		this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
		return worker;
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
