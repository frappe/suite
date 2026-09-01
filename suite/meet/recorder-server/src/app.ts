import express, {
	type NextFunction,
	type Request,
	type Response,
} from 'express';
import { Counter, Gauge, Registry } from 'prom-client';
import { AuthError, type AuthManager } from './AuthManager.js';
import type { Config } from './config.js';
import type { JobManager } from './JobManager.js';
import type { Logger } from './logger.js';
import {
	type CommandClaims,
	type JobRecord,
	PROTOCOL_VERSION,
} from './types.js';

const HEALTH_REASON_CODES = new Set([
	'browser_disconnected',
	'capture_interrupted',
	'configuration_failed',
	'duration_limit',
	'ffmpeg_exited',
	'interruption_timeout',
	'media_attachment_failed',
	'media_subscription_failed',
	'page_crashed',
	'projection_invalid',
	'quota_limit',
	'receive_transport_failed',
	'room_empty',
	'service_shutdown',
	'sfu_disconnected',
	'worker_missing_after_restart',
]);

interface ReserveBody {
	protocol_version: typeof PROTOCOL_VERSION;
	job: string;
}

interface GrantBody {
	protocol_version: typeof PROTOCOL_VERSION;
	grant: string;
	endpoint_generation: number;
}

interface StopBody {
	protocol_version: typeof PROTOCOL_VERSION;
	job: string;
	operation_id: string;
}

function exactBody(value: unknown, keys: string[]): value is object {
	return (
		!!value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys)
	);
}

export function reserveBody(value: unknown): value is ReserveBody {
	return (
		exactBody(value, ['job', 'protocol_version']) &&
		'protocol_version' in value &&
		value.protocol_version === PROTOCOL_VERSION &&
		'job' in value &&
		typeof value.job === 'string'
	);
}

export function grantBody(value: unknown): value is GrantBody {
	return (
		exactBody(value, ['endpoint_generation', 'grant', 'protocol_version']) &&
		'protocol_version' in value &&
		value.protocol_version === PROTOCOL_VERSION &&
		'grant' in value &&
		typeof value.grant === 'string' &&
		value.grant.length > 0 &&
		'endpoint_generation' in value &&
		typeof value.endpoint_generation === 'number' &&
		Number.isSafeInteger(value.endpoint_generation) &&
		value.endpoint_generation >= 0
	);
}

export function stopBody(value: unknown): value is StopBody {
	return (
		exactBody(value, ['job', 'operation_id', 'protocol_version']) &&
		'protocol_version' in value &&
		value.protocol_version === PROTOCOL_VERSION &&
		'job' in value &&
		typeof value.job === 'string' &&
		'operation_id' in value &&
		typeof value.operation_id === 'string' &&
		value.operation_id.length > 0
	);
}

function accepted(job: JobRecord) {
	const milestoneEntries = [
		['configured', job.configured_at],
		['proof_complete', job.proof_completed_at],
		['joined', job.joined_at],
		['capture_started', job.capture_started_at],
	] as const;
	const milestones = Object.fromEntries(
		milestoneEntries.filter(([, value]) => value) as readonly (readonly [
			string,
			string,
		])[],
	);
	return {
		protocol_version: PROTOCOL_VERSION,
		status: 'accepted',
		job: job.job,
		accepted_at: job.accepted_at,
		public_jwk: job.public_jwk,
		endpoint_generation: job.endpoint_generation,
		state: job.state,
		event_sequence: job.event_sequence ?? 1,
		...(Object.keys(milestones).length ? { milestones } : {}),
		...(job.health_reason
			? { reason_code: healthReasonCode(job.health_reason) }
			: {}),
		...(job.replacement_ready_at
			? { replacement_ready_at: job.replacement_ready_at }
			: {}),
		...(job.interruption_id
			? {
					interruption: {
						id: job.interruption_id,
						interrupted_at: job.interrupted_at,
						deadline: job.interruption_deadline,
						omission_started_at: job.omission_started_at,
						resumed_capture_started_at: job.resumed_capture_started_at ?? null,
						recovered_at: job.recovered_at ?? null,
					},
				}
			: {}),
	};
}

function healthReasonCode(reason: string): string {
	if (HEALTH_REASON_CODES.has(reason)) return reason;
	if (reason.includes('budget') || reason.includes('quota'))
		return 'quota_limit';
	if (reason.includes('time_limit') || reason.includes('duration'))
		return 'duration_limit';
	if (reason.includes('recovery_timeout') || reason.includes('interruption'))
		return 'interruption_timeout';
	if (reason.includes('shutdown')) return 'service_shutdown';
	if (reason.includes('room_empty')) return 'room_empty';
	if (reason.includes('ffmpeg') || reason.includes('segment'))
		return 'ffmpeg_exited';
	if (reason.includes('worker_missing')) return 'worker_missing_after_restart';
	return 'capture_interrupted';
}

export function createApp(
	config: Config,
	auth: AuthManager,
	jobs: JobManager,
	log: Logger,
) {
	const app = express();
	const registry = new Registry();
	const starts = new Counter({
		name: 'recorder_starts_total',
		help: 'Recorder reservation outcomes',
		labelNames: ['outcome', 'reason'],
		registers: [registry],
	});
	const active = new Gauge({
		name: 'recorder_active_jobs',
		help: 'Durable active recorder jobs',
		registers: [registry],
		collect() {
			this.set(jobs.activeCount);
		},
	});
	const capacity = new Gauge({
		name: 'recorder_capacity',
		help: 'Configured recorder capacity',
		registers: [registry],
	});
	capacity.set(config.maxConcurrent);
	void active;
	app.disable('x-powered-by');
	const json = express.json({
		limit: '16kb',
		strict: true,
		type: 'application/json',
	});

	app.get('/health', (_req, res) => res.json({ status: 'ok' }));
	app.get('/ready', (_req, res) =>
		res
			.status(jobs.ready ? 200 : 503)
			.json({ status: jobs.ready ? 'ready' : 'not_ready' }),
	);
	app.get('/metrics', async (req, res) => {
		if (
			!auth.authenticateMetrics(
				req.header('authorization'),
				config.metricsToken,
			)
		)
			return res.status(401).json({ status: 'unauthorized' });
		res.type(registry.contentType).send(await registry.metrics());
	});

	function command(operation: CommandClaims['operation']) {
		return (req: Request, res: Response, next: NextFunction): void => {
			try {
				const claims = auth.authenticate(
					req.header('authorization'),
					operation,
				);
				if (req.params.id !== undefined && req.params.id !== claims.job)
					throw new AuthError('route binding mismatch');
				res.locals.command = claims;
				next();
			} catch (error) {
				log.info({
					event: 'authorization_rejected',
					reason: error instanceof AuthError ? error.message : 'invalid',
				});
				res
					.status(401)
					.json({ protocol_version: PROTOCOL_VERSION, status: 'unauthorized' });
			}
		};
	}

	app.post(
		'/v1/recordings',
		command('reserve'),
		json,
		async (req, res, next) => {
			try {
				const claims = res.locals.command as CommandClaims;
				const body: unknown = req.body;
				if (!reserveBody(body) || body.job !== claims.job)
					return res.status(422).json({
						protocol_version: PROTOCOL_VERSION,
						status: 'rejected',
						job: claims.job,
						reason_code: 'invalid_job',
					});
				await auth.consume(claims);
				const result = await jobs.reserve(claims);
				if (result.status === 'accepted') {
					starts.inc({ outcome: 'accepted', reason: 'none' });
					log.info({ event: 'job_reservation', status: 'accepted' });
					return res.status(202).json(accepted(result.job));
				}
				starts.inc({ outcome: 'rejected', reason: result.reason });
				return res
					.status(
						result.reason === 'capacity'
							? 429
							: result.reason === 'storage'
								? 507
								: 422,
					)
					.json({
						protocol_version: PROTOCOL_VERSION,
						status: 'rejected',
						job: claims.job,
						reason_code: result.reason,
					});
			} catch (error) {
				next(error);
			}
		},
	);

	app.get('/v1/recordings/:id', command('query'), async (_req, res, next) => {
		try {
			const claims = res.locals.command as CommandClaims;
			await auth.consume(claims);
			const job = jobs.query(claims);
			return job
				? res.json(accepted(job))
				: res.status(422).json({
						protocol_version: PROTOCOL_VERSION,
						status: 'rejected',
						job: claims.job,
						reason_code: 'invalid_job',
					});
		} catch (error) {
			next(error);
		}
	});

	app.post(
		'/v1/recordings/:id/grant',
		command('grant'),
		json,
		async (req, res, next) => {
			try {
				const claims = res.locals.command as CommandClaims;
				const body: unknown = req.body;
				if (!grantBody(body))
					return res.status(422).json({
						protocol_version: PROTOCOL_VERSION,
						status: 'rejected',
						job: claims.job,
						reason_code: 'invalid_job',
					});
				await auth.consume(claims);
				if (!(await jobs.grant(claims, body.grant, body.endpoint_generation)))
					return res.status(422).json({
						protocol_version: PROTOCOL_VERSION,
						status: 'rejected',
						job: claims.job,
						reason_code: 'invalid_job',
					});
				log.info({ event: 'job_grant', status: 'accepted' });
				return res.json({
					protocol_version: PROTOCOL_VERSION,
					status: 'accepted',
				});
			} catch (error) {
				next(error);
			}
		},
	);

	app.post(
		'/v1/recordings/:id/stop',
		command('stop'),
		json,
		async (req, res, next) => {
			try {
				const claims = res.locals.command as CommandClaims;
				const body: unknown = req.body;
				if (!stopBody(body) || body.job !== claims.job)
					return res.status(422).json({
						protocol_version: PROTOCOL_VERSION,
						status: 'rejected',
						job: claims.job,
						reason_code: 'invalid_job',
					});
				await auth.consume(claims);
				if (!(await jobs.stop(claims, body.operation_id)))
					return res.status(422).json({
						protocol_version: PROTOCOL_VERSION,
						status: 'rejected',
						job: claims.job,
						reason_code: 'invalid_job',
					});
				log.info({ event: 'job_stop', status: 'accepted' });
				return res.status(202).json({
					protocol_version: PROTOCOL_VERSION,
					status: 'accepted',
					job: claims.job,
					operation_id: body.operation_id,
				});
			} catch (error) {
				next(error);
			}
		},
	);

	app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
		if (error instanceof AuthError)
			return res
				.status(401)
				.json({ protocol_version: PROTOCOL_VERSION, status: 'unauthorized' });
		const status =
			'status' in error && error.status === 413
				? 413
				: error instanceof SyntaxError
					? 400
					: 503;
		log.error({
			event: 'service_error',
			reason:
				status === 413
					? 'request_too_large'
					: status === 400
						? 'invalid_json'
						: 'unavailable',
		});
		res
			.status(status)
			.json({ protocol_version: PROTOCOL_VERSION, status: 'indeterminate' });
	});
	return app;
}
