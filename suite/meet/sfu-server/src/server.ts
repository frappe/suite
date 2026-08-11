import http from 'node:http';
import { join } from 'node:path';
import cors from 'cors';
import express, { type Application } from 'express';
import { Server } from 'socket.io';
import { loadConfig, type SFUConfig } from './config';
import { MediasoupManager } from './mediasoup/MediasoupManager';
import { AuthManager } from './server/AuthManager';
import { InMemoryE2eeCoordinatorPersistence } from './server/E2eeCoordinatorPersistence';
import { InMemoryRosterPersistence } from './server/E2eeRosterPersistence';
import { FileRosterPersistence } from './server/E2eeRosterPersistenceFile';
import { E2eeRosterStore } from './server/E2eeRosterStore';
import { RecordingGrantManager } from './server/RecordingGrantManager';
import { RecordingGrantPersistenceFile } from './server/RecordingGrantPersistenceFile';
import { RouteManager } from './server/RouteManager';
import { SocketHandlerManager } from './server/SocketHandlerManager';
import { Telemetry } from './telemetry/Telemetry';
import { configureLogging, loggers } from './utils/logger';
import { captureException, flushSentry, initSentry } from './utils/sentry';

const RECORDING_AUTHORIZATION_RETRY_MS = 30_000;

export class SFUServer {
	private app: Application;
	private server: http.Server;
	private io: Server;
	private mediasoup: MediasoupManager;
	private authManager: AuthManager;
	private routeManager: RouteManager;
	private socketHandlerManager: SocketHandlerManager;
	private config: SFUConfig['server'];
	private telemetry: Telemetry;
	private recordingGrantPersistence?: RecordingGrantPersistenceFile;
	private recordingGrantRetry: NodeJS.Timeout | null = null;
	private recordingGrantInitialization: Promise<void> | null = null;
	private recordingGrantFailureReported = false;

	constructor(config: SFUConfig) {
		this.config = config.server;

		loggers.server.info(
			'SFU Server will run on http://%s:%d',
			this.config.host,
			this.config.port,
		);

		this.app = express();
		this.server = http.createServer(this.app);
		this.io = new Server(this.server, {
			cors: {
				origin: '*',
				methods: ['GET', 'POST'],
				allowedHeaders: ['*'],
				credentials: false,
			},
			pingTimeout: config.socket.pingTimeout,
			pingInterval: config.socket.pingInterval,
		});

		this.mediasoup = new MediasoupManager(config.mediasoup);
		this.telemetry = new Telemetry();
		this.mediasoup.onTransportStateChange((event) =>
			this.telemetry.recordTransportState(event),
		);
		this.mediasoup.onMediaScore((direction, media, score) =>
			this.telemetry.mediaScore.observe({ direction, media }, score),
		);
		const recordingPersistencePath = config.persistence.recordingGrantFile;
		this.recordingGrantPersistence = recordingPersistencePath
			? new RecordingGrantPersistenceFile(recordingPersistencePath)
			: undefined;
		const recordingGrantManager = recordingPersistencePath
			? new RecordingGrantManager(
					this.config.jwtSecret,
					this.recordingGrantPersistence!,
				)
			: undefined;
		this.authManager = new AuthManager(
			this.config.jwtSecret,
			recordingGrantManager,
		);
		this.routeManager = new RouteManager(
			this.app,
			this.mediasoup,
			this.telemetry,
			() => this.io.sockets.sockets.size,
			config.metrics.token,
		);
		const e2eeRoster = new E2eeRosterStore(
			config.persistence.e2eeRosterDirectory
				? new FileRosterPersistence(
						join(config.persistence.e2eeRosterDirectory, 'roster.json'),
					)
				: new InMemoryRosterPersistence(),
		);
		const e2eeCoordinatorPersistence = new InMemoryE2eeCoordinatorPersistence();
		this.socketHandlerManager = new SocketHandlerManager(
			this.io,
			this.mediasoup,
			this.authManager,
			this.telemetry,
			e2eeRoster,
			config.runtime,
			e2eeCoordinatorPersistence,
			recordingGrantManager,
		);

		this.setupMiddleware();
		this.routeManager.setupRoutes();
		this.socketHandlerManager.setupSocketHandlers();
	}

	private setupMiddleware(): void {
		this.app.use(cors());
		this.app.use(express.json());
	}

	private initializeRecordingAuthorization(): Promise<void> {
		const persistence = this.recordingGrantPersistence;
		if (!persistence || persistence.isReady()) return Promise.resolve();
		if (this.recordingGrantInitialization)
			return this.recordingGrantInitialization;

		this.recordingGrantInitialization = persistence
			.initialize()
			.then(() => {
				if (this.recordingGrantFailureReported) {
					loggers.server.info('Recording authorization recovered');
				}
				this.recordingGrantFailureReported = false;
			})
			.catch((error) => {
				if (!this.recordingGrantFailureReported) {
					loggers.server.error(
						'Recording authorization unavailable: %s',
						(error as Error).message,
					);
					captureException(error);
					this.recordingGrantFailureReported = true;
				}
			})
			.finally(() => {
				this.recordingGrantInitialization = null;
			});
		return this.recordingGrantInitialization;
	}

	async start(): Promise<void> {
		try {
			loggers.server.info('Starting SFU Server');

			await this.mediasoup.init();
			await this.initializeRecordingAuthorization();
			if (this.recordingGrantPersistence) {
				this.recordingGrantRetry = setInterval(
					() => void this.initializeRecordingAuthorization(),
					RECORDING_AUTHORIZATION_RETRY_MS,
				);
				this.recordingGrantRetry.unref();
			}

			this.server.listen(this.config.port, this.config.host, () => {
				loggers.server.info(
					'SFU Server running on http://%s:%d',
					this.config.host,
					this.config.port,
				);
			});
		} catch (error) {
			loggers.server.error(
				'Failed to start SFU server: %s',
				(error as Error).message,
			);
			captureException(error);
			await flushSentry();
			process.exit(1);
		}
	}

	async stop(): Promise<void> {
		loggers.server.info('Stopping SFU Server');
		if (this.recordingGrantRetry) clearInterval(this.recordingGrantRetry);
		this.recordingGrantRetry = null;

		try {
			this.socketHandlerManager.stop();
			await this.mediasoup.cleanup();

			this.server.close(() => {
				loggers.server.info('SFU Server stopped');
			});
		} catch (error) {
			loggers.server.error(
				'Error during server shutdown: %s',
				(error as Error).message,
			);
			this.socketHandlerManager.stop();
			this.server.close(() => {
				loggers.server.info('SFU Server force stopped');
			});
		}
	}
}

let sfuServer: SFUServer | undefined;

process.on('SIGINT', async () => {
	loggers.server.info('Received SIGINT, shutting down gracefully');
	await sfuServer?.stop();
	process.exit(0);
});

process.on('SIGTERM', async () => {
	loggers.server.info('Received SIGTERM, shutting down gracefully');
	await sfuServer?.stop();
	process.exit(0);
});

process.on('uncaughtException', (error) => {
	loggers.server.error(
		'Uncaught exception (process will exit): %s\n%s',
		error.message,
		error.stack,
	);
	captureException(error);
	void flushSentry().finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
	const err = reason instanceof Error ? reason : new Error(String(reason));
	loggers.server.error(
		'Unhandled rejection (process will exit): %s\n%s',
		err.message,
		err.stack,
	);
	captureException(err);
	void flushSentry().finally(() => process.exit(1));
});

function main(): void {
	let config: SFUConfig;
	try {
		config = loadConfig();
	} catch (error) {
		console.error((error as Error).message);
		process.exit(1);
	}

	configureLogging(config.logging.level);
	initSentry(config.sentry);

	try {
		sfuServer = new SFUServer(config);
		sfuServer.start().catch((error) => {
			loggers.server.error(
				'Failed to start SFU server: %s',
				(error as Error).message,
			);
			captureException(error);
			void flushSentry().finally(() => process.exit(1));
		});
	} catch (error) {
		loggers.server.error(
			'Failed to configure SFU server: %s',
			(error as Error).message,
		);
		captureException(error);
		void flushSentry().finally(() => process.exit(1));
	}
}

main();
