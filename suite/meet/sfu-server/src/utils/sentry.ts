import * as Sentry from '@sentry/node';
import type { SFUConfig } from '../config';

let enabled = false;

export function initSentry(config: SFUConfig['sentry']): void {
	enabled = Boolean(config.dsn);
	if (!config.dsn) return;

	Sentry.init({
		dsn: config.dsn,
		environment: config.environment,
		release: config.release,
		tracesSampleRate: 0,
		initialScope: {
			tags: { service: 'meet-sfu' },
		},
	});
}

export function captureException(error: unknown): void {
	if (!enabled) return;
	Sentry.captureException(error);
}

export async function flushSentry(): Promise<void> {
	if (!enabled) return;
	await Sentry.flush(2000);
}
