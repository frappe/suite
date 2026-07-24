import fs from 'node:fs';
import path from 'node:path';
import type { Application, Request, Response } from 'express';
import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import type { Telemetry } from '../telemetry/Telemetry';
import type { HealthStats } from '../types';

export class RouteManager {
	private app: Application;
	private mediasoup: MediasoupManager;
	private telemetry: Telemetry;
	private metricsToken?: string;
	private getSocketCount: () => number;

	private static version: string = RouteManager.readVersion();

	private static readVersion(): string {
		try {
			const pkgPath = path.join(__dirname, '..', '..', 'package.json');
			const raw = fs.readFileSync(pkgPath, 'utf8');
			const json = JSON.parse(raw) as { version?: string };
			return json.version ?? 'unknown';
		} catch (_err) {
			return 'unknown';
		}
	}

	constructor(
		app: Application,
		mediasoup: MediasoupManager,
		telemetry: Telemetry,
		getSocketCount: () => number,
	) {
		this.app = app;
		this.mediasoup = mediasoup;
		this.telemetry = telemetry;
		this.metricsToken = process.env.METRICS_TOKEN;
		this.getSocketCount = getSocketCount;
	}

	setupRoutes(): void {
		this.app.get('/', (_req: Request, res: Response) => {
			res.json({
				message: 'Frappe Meet SFU Server is running',
				version: RouteManager.version,
				timestamp: new Date().toISOString(),
			});
		});

		this.app.get('/health', (_req: Request, res: Response) => {
			const stats: HealthStats = {
				status: 'healthy',
				uptime: process.uptime(),
				rooms: this.mediasoup.rooms.getRoomCount(),
				peers: this.mediasoup.peers.getPeerCount(),
			};
			res.json(stats);
		});

		this.app.get('/metrics', async (req: Request, res: Response) => {
			if (
				!this.metricsToken ||
				req.headers.authorization !== `Bearer ${this.metricsToken}`
			) {
				res.sendStatus(this.metricsToken ? 401 : 404);
				return;
			}
			this.telemetry.setResources({
				...this.mediasoup.getResourceCounts(),
				sockets: this.getSocketCount(),
			});
			this.telemetry.setWorkerResources(
				await this.mediasoup.getWorkerResourceUsage(),
			);
			res.set('Content-Type', this.telemetry.registry.contentType);
			res.send(await this.telemetry.registry.metrics());
		});
	}
}
