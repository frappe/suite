import express, { type Application, type Request } from 'express';
import jwt from 'jsonwebtoken';
import type { Config } from './config.js';
import type {
	SourceManifest,
	SourceSegment,
	TranscriptionStore,
} from './TranscriptionStore.js';

export function transcriptionRoutes(
	app: Application,
	config: Config,
	store: TranscriptionStore,
): void {
	function claims(req: Request, operation: string) {
		const token = req.header('authorization')?.match(/^Bearer (\S+)$/)?.[1];
		if (!token) throw new Error('unauthorized');
		const decoded = jwt.verify(token, config.secret, {
			algorithms: ['HS256'],
			audience: 'meet-transcription-source',
			issuer: config.origin,
			complete: true,
		});
		if (
			typeof decoded === 'string' ||
			typeof decoded.payload === 'string' ||
			decoded.header.typ !== 'meet-transcription-source+jwt'
		)
			throw new Error('unauthorized');
		const c = decoded.payload;
		if (
			c.site !== config.site ||
			c.origin !== config.origin ||
			c.capture !== req.params.capture ||
			typeof c.room !== 'string' ||
			!c.room ||
			c.operation !== operation ||
			typeof c.iat !== 'number' ||
			!Number.isInteger(c.iat) ||
			typeof c.exp !== 'number' ||
			!Number.isInteger(c.exp) ||
			c.iat > Date.now() / 1000 + 5 ||
			c.exp - c.iat > (operation === 'capture' ? 14460 : 120)
		)
			throw new Error('unauthorized');
		return c;
	}
	function route(
		operation: string,
		work: (req: Request, c: jwt.JwtPayload) => Promise<unknown>,
	) {
		return async (req: Request, res: express.Response) => {
			let c: jwt.JwtPayload;
			try {
				c = claims(req, operation);
			} catch {
				res.status(401).json({ error: 'unauthorized' });
				return;
			}
			try {
				if (!store.ready) {
					res.status(503).json({ error: 'storage_unavailable' });
					return;
				}
				const result = await work(req, c);
				if (typeof result === 'string') res.sendFile(result);
				else res.json(result ?? { status: 'accepted' });
			} catch (error) {
				const reason = error instanceof Error ? error.message : 'unavailable';
				res
					.status(
						reason === 'storage'
							? 507
							: reason === 'capacity'
								? 429
								: (error as NodeJS.ErrnoException).code === 'ENOENT' ||
										reason === 'source_missing'
									? 404
									: 422,
					)
					.json({
						error: [
							'storage',
							'capacity',
							'capture_closed',
							'capture_conflict',
							'segment_conflict',
							'invalid_segment',
							'invalid_limits',
							'invalid_gaps',
							'source_missing',
						].includes(reason)
							? reason
							: 'invalid_request',
					});
			}
		};
	}
	const base = '/v1/transcriptions/:capture';
	app.post(
		base,
		express.json({ limit: '4kb' }),
		route('reserve', async (req, c) => {
			if (
				req.body.max_bytes !== c.max_bytes ||
				req.body.max_duration_ms !== c.max_duration_ms
			)
				throw new Error('invalid_limits');
			return store.reserve(
				c.site,
				c.room,
				c.capture,
				c.max_bytes,
				c.max_duration_ms,
			);
		}),
	);
	app.get(
		`${base}/capture-state`,
		route('capture', async (_req, c) => {
			const m = await store.manifest(c.site, c.capture);
			if (m.room !== c.room) throw new Error('unauthorized');
			return { state: m.state, started_at: m.started_at };
		}),
	);

	app.get(
		`${base}/manifest`,
		route('manifest', async (_req, c) => {
			let m: SourceManifest;
			try {
				m = await store.manifest(c.site, c.capture);
			} catch (error) {
				if (
					error instanceof Error &&
					error.message === 'source_manifest_unavailable'
				)
					return store.failedManifest(c.site, c.room, c.capture);
				throw error;
			}
			if (m.room !== c.room) throw new Error('unauthorized');
			return m;
		}),
	);
	app.post(
		`${base}/begin`,
		express.json({ limit: '4kb' }),
		route('capture', async (req, c) => {
			const m = await store.manifest(c.site, c.capture);
			if (m.room !== c.room) throw new Error('unauthorized');
			await store.begin(
				c.site,
				c.capture,
				req.body.started_at,
				req.body.speech_context,
			);
		}),
	);

	app.post(
		`${base}/participants`,
		express.json({ limit: '16kb' }),
		route('capture', async (req, c) => {
			const manifest = await store.manifest(c.site, c.capture);
			if (manifest.room !== c.room) throw new Error('unauthorized');
			await store.updateParticipants(c.site, c.capture, req.body.names);
		}),
	);

	app.put(
		`${base}/segments/:source`,
		express.raw({ type: 'application/octet-stream', limit: 1440000 }),
		route('capture', async (req, c) => {
			const m = await store.manifest(c.site, c.capture);
			if (m.room !== c.room) throw new Error('unauthorized');
			if (!Buffer.isBuffer(req.body)) throw new Error('invalid_segment');
			const segment: SourceSegment = {
				source_id: String(req.params.source),
				speaker_id: decodeURIComponent(req.header('x-speaker-id') ?? ''),
				speaker_name: decodeURIComponent(req.header('x-speaker-name') ?? ''),
				start_ms: Number(req.header('x-start-ms')),
				end_ms: Number(req.header('x-end-ms')),
				size: req.body.length,
				sha256: req.header('x-sha256') ?? '',
				sample_rate: 24000,
			};
			await store.append(c.site, c.capture, segment, req.body);
		}),
	);
	app.post(
		`${base}/complete`,
		express.json({ limit: '512kb' }),
		route('capture', async (req, c) => {
			const m = await store.manifest(c.site, c.capture);
			if (m.room !== c.room) throw new Error('unauthorized');
			return store.complete(c.site, c.capture, req.body.gaps);
		}),
	);
	app.get(
		`${base}/segments/:source`,
		route('source', async (req, c) => {
			if (c.source_id !== req.params.source) throw new Error('source_missing');
			const m = await store.manifest(c.site, c.capture);
			if (m.room !== c.room) throw new Error('unauthorized');
			return store.audio(c.site, c.capture, String(req.params.source));
		}),
	);
	app.delete(
		base,
		route('delete', async (_req, c) => {
			try {
				const m = await store.manifest(c.site, c.capture);
				if (m.room !== c.room) throw new Error('unauthorized');
			} catch (error) {
				if (
					(error as NodeJS.ErrnoException).code !== 'ENOENT' &&
					!(
						error instanceof Error &&
						error.message === 'source_manifest_unavailable'
					)
				)
					throw error;
			}
			await store.delete(c.site, c.capture);
		}),
	);
}
