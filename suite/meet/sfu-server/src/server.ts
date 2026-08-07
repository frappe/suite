import http from 'node:http';
import { join } from 'node:path';
import cors from 'cors';
import express, { type Application } from 'express';
import { Server } from 'socket.io';
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
import type { ServerConfig } from './types';
import { loggers } from './utils/logger';
import { captureException, flushSentry, initSentry } from './utils/sentry';

initSentry();

function socketTimeout(envName: string, fallback: number): number {
	const value = Number.parseInt(process.env[envName] || '', 10);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

export class SFUServer {
	private app: Application;
	private server: http.Server;
	private io: Server;
	private mediasoup: MediasoupManager;
	private authManager: AuthManager;
	private routeManager: RouteManager;
	private socketHandlerManager: SocketHandlerManager;
	private config: ServerConfig;
	private telemetry: Telemetry;
	private recordingGrantPersistence?: RecordingGrantPersistenceFile;

	constructor() {
		const jwtSecret = process.env.JWT_SECRET;
		if (!jwtSecret) {
			throw new Error('JWT_SECRET environment variable is required');
		}
		this.config = {
			port: Number.parseInt(process.env.PORT || '3000', 10),
			host: process.env.HOST || '0.0.0.0',
			jwtSecret,
		};

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
			pingTimeout: socketTimeout('SOCKET_PING_TIMEOUT', 60000),
			pingInterval: socketTimeout('SOCKET_PING_INTERVAL', 25000),
		});

		this.mediasoup = new MediasoupManager();
		this.telemetry = new Telemetry();
		this.mediasoup.onTransportStateChange((event) =>
			this.telemetry.recordTransportState(event),
		);
		this.mediasoup.onMediaScore((direction, media, score) =>
			this.telemetry.mediaScore.observe({ direction, media }, score),
		);
		const recordingPersistencePath =
			process.env.RECORDING_GRANT_PERSISTENCE_FILE;
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
		);
		const e2eeRoster = new E2eeRosterStore(
			process.env.E2EE_ROSTER_PERSISTENCE_DIR
				? new FileRosterPersistence(
						join(process.env.E2EE_ROSTER_PERSISTENCE_DIR, 'roster.json'),
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

	async start(): Promise<void> {
		try {
			loggers.server.info('Starting SFU Server');

			await this.mediasoup.init();
			if (this.recordingGrantPersistence) {
				await this.recordingGrantPersistence.initialize().catch((error) => {
					loggers.server.error(
						'Recording authorization unavailable: %s',
						(error as Error).message,
					);
				});
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

try {
	sfuServer = new SFUServer();
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
