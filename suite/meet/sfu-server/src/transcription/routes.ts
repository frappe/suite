import type { Application } from 'express';
import * as jwt from 'jsonwebtoken';
import type { Server } from 'socket.io';
import type { TranscriptionManager } from './TranscriptionManager';

export function transcriptionRoutes(
	app: Application,
	io: Server,
	manager: TranscriptionManager,
	secret: string,
	recorderOrigin: string | undefined,
): void {
	const base = '/v1/transcriptions/:capture';
	for (const operation of ['start', 'stop', 'query'] as const) {
		const url = operation === 'query' ? base : `${base}/${operation}`;
		app[operation === 'query' ? 'get' : 'post'](url, async (req, res) => {
			let c: jwt.JwtPayload;
			try {
				const token = req.header('authorization')?.match(/^Bearer (\S+)$/)?.[1];
				if (!token) throw new Error('unauthorized');
				const verified = jwt.verify(token, secret, {
					algorithms: ['HS256'],
					audience: 'meet-transcription-control',
					complete: true,
				});
				if (
					typeof verified === 'string' ||
					typeof verified.payload === 'string' ||
					verified.header.typ !== 'meet-transcription-command+jwt'
				)
					throw new Error('unauthorized');
				c = verified.payload;
				if (
					typeof c.site !== 'string' ||
					!c.site ||
					typeof c.room !== 'string' ||
					!c.room ||
					c.capture !== req.params.capture ||
					c.operation !== operation ||
					typeof c.origin !== 'string' ||
					new URL(c.origin).origin !== c.origin ||
					c.iss !== c.origin ||
					typeof c.iat !== 'number' ||
					!Number.isInteger(c.iat) ||
					typeof c.exp !== 'number' ||
					!Number.isInteger(c.exp) ||
					c.iat > Date.now() / 1000 + 5 ||
					c.exp - c.iat > 120
				)
					throw new Error('unauthorized');
			} catch {
				res.status(401).json({ error: 'unauthorized' });
				return;
			}
			try {
				if (operation === 'start') {
					if (
						!recorderOrigin ||
						req.body.recorder_origin !== recorderOrigin ||
						new URL(recorderOrigin).origin !== recorderOrigin ||
						typeof req.body.source_token !== 'string'
					)
						throw new Error('recorder_unavailable');
					const participants = [...io.sockets.sockets.values()].filter(
						(s) =>
							s.site === c.site && s.meetingId === c.room && s.scope === 'full',
					);
					if (!participants.length || participants.some((s) => s.e2eeRequired))
						throw new Error('capture_unavailable');
					res.json(
						await manager.start(
							c.site,
							c.room,
							c.capture,
							recorderOrigin,
							req.body.source_token,
							req.body.max_duration_ms,
						),
					);
				} else if (operation === 'stop') {
					if (manager.query(c.site, c.capture)?.room !== c.room)
						throw new Error('capture_unavailable');
					void manager.stop(c.site, c.capture).catch(() => {});
					res.status(202).json(
						manager.query(c.site, c.capture) ?? {
							capture: c.capture,
							state: 'missing',
						},
					);
				} else {
					const state = manager.query(c.site, c.capture);
					if (state && state.room !== c.room)
						throw new Error('capture_unavailable');
					res
						.status(state ? 200 : 404)
						.json(state ?? { error: 'capture_missing' });
				}
			} catch {
				res.status(409).json({ error: 'capture_unavailable' });
			}
		});
	}
}
