import { AuthManager } from './AuthManager.js';
import { createApp } from './app.js';
import { CallbackClient } from './CallbackClient.js';
import { CaptureWorkerManager } from './CaptureWorkerManager.js';
import { loadConfig } from './config.js';
import { JobManager } from './JobManager.js';
import { JobStore } from './JobStore.js';
import { logger } from './logger.js';
import { ChromiumRendererBridge } from './RendererBridge.js';

async function main(): Promise<void> {
	const config = loadConfig();
	const store = new JobStore(config.ledgerPath);
	await store.initialize();
	let capture!: CaptureWorkerManager;
	const renderer = new ChromiumRendererBridge({
		executablePath: config.chromiumExecutable,
		assetDirectory: config.rendererAssetDirectory,
		sfuOrigin: config.sfuOrigin,
		sfuSocketPath: config.sfuSocketPath,
		trustedCommandOrigin: config.origin,
		listenerPort: config.rendererPort,
		noSandbox: config.rendererNoSandbox,
		reserveTimeoutMs: config.rendererReserveTimeoutMs,
		configureTimeoutMs: config.rendererConfigureTimeoutMs,
		workerEnvironment: (job) => capture.workerEnvironment(job),
	});
	await renderer.initialize();
	capture = new CaptureWorkerManager(renderer, {
		dataRoot: config.dataRoot,
		segmentSeconds: config.segmentSeconds,
		ffmpeg: config.ffmpegExecutable,
		xvfb: config.xvfbExecutable,
		pulseaudio: config.pulseaudioExecutable,
		pactl: config.pactlExecutable,
		gracefulTimeoutMs: 10_000,
		recoveryTimeoutMs: 60_000,
		maxConcurrent: config.maxConcurrent,
	});
	const callbacks = new CallbackClient({
		origin: config.origin,
		site: config.site,
		secret: config.secret,
		dataRoot: config.dataRoot,
	});
	const jobs = new JobManager(
		store,
		capture,
		config.maxConcurrent,
		(job) => callbacks.upload(job),
		async (job) => {
			await callbacks.interrupted(job).catch((error: unknown) =>
				logger.error({
					event: 'interruption_callback_failed',
					reason: error instanceof Error ? error.message : 'callback_failed',
				}),
			);
		},
		undefined,
		async (job) => {
			await callbacks.recovered(job).catch((error: unknown) =>
				logger.error({
					event: 'recovery_callback_failed',
					reason: error instanceof Error ? error.message : 'callback_failed',
				}),
			);
		},
	);
	await jobs.initialize();
	const auth = new AuthManager(
		config.secret,
		config.site,
		config.origin,
		store,
	);
	const server = createApp(config, auth, jobs, logger).listen(config.port);
	let shuttingDown = false;
	const shutdown = async () => {
		if (shuttingDown) return;
		shuttingDown = true;
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await capture.close();
	};
	process.once('SIGINT', () => void shutdown());
	process.once('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
	logger.error({
		event: 'service_error',
		reason: error instanceof Error ? error.message : 'startup_failed',
	});
	process.exitCode = 1;
});
