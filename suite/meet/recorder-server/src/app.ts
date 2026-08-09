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
import type { CommandClaims, JobRecord } from './types.js';

interface ReserveBody {
	job: string;
}

interface GrantBody {
	grant: string;
}

interface StopBody {
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

function reserveBody(value: unknown): value is ReserveBody {
	return (
		exactBody(value, ['job']) && 'job' in value && typeof value.job === 'string'
	);
}

function grantBody(value: unknown): value is GrantBody {
	return (
		exactBody(value, ['grant']) &&
		'grant' in value &&
		typeof value.grant === 'string' &&
		value.grant.length > 0
	);
}

function stopBody(value: unknown): value is StopBody {
	return (
		exactBody(value, ['job', 'operation_id']) &&
		'job' in value &&
		typeof value.job === 'string' &&
		'operation_id' in value &&
		typeof value.operation_id === 'string' &&
		value.operation_id.length > 0
	);
}

function accepted(job: JobRecord) {
	return {
		status: 'accepted',
		job: job.job,
		accepted_at: job.accepted_at,
		public_jwk: job.public_jwk,
		state: job.state,
		...(job.artifact ? { artifact: job.artifact } : {}),
		...(job.health_reason ? { health_reason: job.health_reason } : {}),
	};
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
	app.use(
		express.json({ limit: '16kb', strict: true, type: 'application/json' }),
	);

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
				res.status(401).json({ status: 'unauthorized' });
			}
		};
	}

	app.post('/v1/recordings', command('reserve'), async (req, res, next) => {
		try {
			const claims = res.locals.command as CommandClaims;
			const body: unknown = req.body;
			if (!reserveBody(body) || body.job !== claims.job)
				return res
					.status(422)
					.json({ status: 'rejected', job: claims.job, reason: 'invalid_job' });
			await auth.consume(claims);
			const result = await jobs.reserve(claims);
			if (result.status === 'accepted') {
				starts.inc({ outcome: 'accepted', reason: 'none' });
				log.info({ event: 'job_reservation', status: 'accepted' });
				return res.status(202).json(accepted(result.job));
			}
			starts.inc({ outcome: 'rejected', reason: result.reason });
			return res
				.status(result.reason === 'capacity' ? 429 : 422)
				.json({ status: 'rejected', job: claims.job, reason: result.reason });
		} catch (error) {
			next(error);
		}
	});

	app.get('/v1/recordings/:id', command('query'), async (_req, res, next) => {
		try {
			const claims = res.locals.command as CommandClaims;
			await auth.consume(claims);
			const job = jobs.query(claims);
			return job
				? res.json(accepted(job))
				: res.status(422).json({
						status: 'rejected',
						job: claims.job,
						reason: 'invalid_job',
					});
		} catch (error) {
			next(error);
		}
	});

	app.post(
		'/v1/recordings/:id/grant',
		command('grant'),
		async (req, res, next) => {
			try {
				const claims = res.locals.command as CommandClaims;
				const body: unknown = req.body;
				if (!grantBody(body))
					return res.status(422).json({
						status: 'rejected',
						job: claims.job,
						reason: 'invalid_job',
					});
				await auth.consume(claims);
				if (!(await jobs.grant(claims, body.grant)))
					return res.status(422).json({
						status: 'rejected',
						job: claims.job,
						reason: 'invalid_job',
					});
				log.info({ event: 'job_grant', status: 'accepted' });
				return res.json({ status: 'accepted' });
			} catch (error) {
				next(error);
			}
		},
	);

	app.post(
		'/v1/recordings/:id/stop',
		command('stop'),
		async (req, res, next) => {
			try {
				const claims = res.locals.command as CommandClaims;
				const body: unknown = req.body;
				if (!stopBody(body) || body.job !== claims.job)
					return res.status(422).json({
						status: 'rejected',
						job: claims.job,
						reason: 'invalid_job',
					});
				await auth.consume(claims);
				if (!(await jobs.stop(claims, body.operation_id)))
					return res.status(422).json({
						status: 'rejected',
						job: claims.job,
						reason: 'invalid_job',
					});
				log.info({ event: 'job_stop', status: 'accepted' });
				return res.status(202).json({
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
			return res.status(401).json({ status: 'unauthorized' });
		log.error({
			event: 'service_error',
			reason: error instanceof SyntaxError ? 'invalid_json' : 'unavailable',
		});
		res
			.status(error instanceof SyntaxError ? 400 : 503)
			.json({ status: 'indeterminate' });
	});
	return app;
}
