import http from 'node:http';
import express, { type Application } from 'express';
import { Server } from 'socket.io';
import { MediasoupManager } from './mediasoup/MediasoupManager';
import { AuthManager } from './server/AuthManager';
import { RouteManager } from './server/RouteManager';
import { SocketHandlerManager } from './server/SocketHandlerManager';
import type { ServerConfig } from './types';
import { loggers } from './utils/logger';

export class SFUServer {
	private app: Application;
	private server: http.Server;
	private io: Server;
	private mediasoup: MediasoupManager;
	private authManager: AuthManager;
	private routeManager: RouteManager;
	private socketHandlerManager: SocketHandlerManager;
	private config: ServerConfig;

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
			pingTimeout: 60000,
			pingInterval: 25000,
		});

		this.mediasoup = new MediasoupManager();
		this.authManager = new AuthManager(this.config.jwtSecret);
		this.routeManager = new RouteManager(this.app, this.mediasoup);
		this.socketHandlerManager = new SocketHandlerManager(
			this.io,
			this.mediasoup,
			this.authManager,
		);

		this.setupMiddleware();
		this.routeManager.setupRoutes();
		this.socketHandlerManager.setupSocketHandlers();
	}

	private setupMiddleware(): void {
		this.app.use(express.json());
	}

	async start(): Promise<void> {
		try {
			loggers.server.info('Starting SFU Server');

			await this.mediasoup.init();

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

const sfuServer = new SFUServer();

process.on('SIGINT', async () => {
	loggers.server.info('Received SIGINT, shutting down gracefully');
	await sfuServer.stop();
	process.exit(0);
});

process.on('SIGTERM', async () => {
	loggers.server.info('Received SIGTERM, shutting down gracefully');
	await sfuServer.stop();
	process.exit(0);
});

process.on('uncaughtException', (error) => {
	loggers.server.error(
		'Uncaught exception (process will exit): %s\n%s',
		error.message,
		error.stack,
	);
	process.exit(1);
});

process.on('unhandledRejection', (reason) => {
	const err = reason instanceof Error ? reason : new Error(String(reason));
	loggers.server.error(
		'Unhandled rejection (process will exit): %s\n%s',
		err.message,
		err.stack,
	);
	process.exit(1);
});

sfuServer.start().catch((error) => {
	loggers.server.error(
		'Failed to start SFU server: %s',
		(error as Error).message,
	);
	process.exit(1);
});
