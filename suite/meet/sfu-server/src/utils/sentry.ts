import * as Sentry from '@sentry/node';

export function initSentry(): void {
	if (!process.env.SENTRY_DSN) return;

	Sentry.init({
		dsn: process.env.SENTRY_DSN,
		environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
		release: process.env.SENTRY_RELEASE,
		tracesSampleRate: 0,
		initialScope: {
			tags: { service: 'meet-sfu' },
		},
	});
}

export function captureException(error: unknown): void {
	if (!process.env.SENTRY_DSN) return;
	Sentry.captureException(error);
}

export async function flushSentry(): Promise<void> {
	if (!process.env.SENTRY_DSN) return;
	await Sentry.flush(2000);
}
