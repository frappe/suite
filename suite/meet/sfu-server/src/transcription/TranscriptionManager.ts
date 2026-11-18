import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import {
	LEGACY_VOCABULARY_VERSION,
	participantHintNames,
	type SpeechScope,
} from '../speechHints';
import { type Gap, SourceCapture } from './SourceCapture';

interface Capture {
	speechContext: SpeechScope;
	participantNames: string[];
	site: string;
	room: string;
	capture: string;
	started_at: string;
	ended_at?: string;
	state: 'capturing' | 'complete' | 'partial';
	epoch: number;
	maxDurationMs: number;
	recorderOrigin: string;
	token: string;
	gaps: Gap[];
	sources: Map<string, SourceCapture>;
	seen: Set<string>;
	closing?: Promise<void>;
	timer?: NodeJS.Timeout;
	polling: boolean;
	lastHeartbeat: number;
}
export class TranscriptionManager {
	private captures = new Map<string, Capture>();
	constructor(
		private readonly media: Pick<MediasoupManager, 'getTranscriptionRoom'>,
		private readonly notify: (room: string, event: unknown) => void,
	) {}
	private key(site: string, id: string): string {
		return `${site}::${id}`;
	}
	query(site: string, id: string) {
		const c = this.captures.get(this.key(site, id));
		return c
			? {
					capture: c.capture,
					speech_context: { ...c.speechContext },
					room: c.room,
					site: c.site,
					state:
						c.closing && c.state === 'capturing'
							? ('stopping' as const)
							: c.state,
					started_at: c.started_at,
					gaps: c.gaps.map((g) => ({ ...g })),
					...(c.ended_at ? { ended_at: c.ended_at } : {}),
				}
			: undefined;
	}
	async start(
		site: string,
		room: string,
		id: string,
		recorderOrigin: string,
		token: string,
		maxDurationMs: number,
	) {
		const key = this.key(site, id);
		const roomId = this.key(site, room);
		const previous = this.captures.get(key);
		if (previous) {
			if (
				previous.room !== room ||
				previous.recorderOrigin !== recorderOrigin ||
				previous.maxDurationMs !== maxDurationMs
			)
				throw new Error('capture_conflict');
			return this.query(site, id);
		}
		if (
			[...this.captures.values()].some(
				(c) =>
					c.site === site &&
					c.room === room &&
					c.state === 'capturing' &&
					!c.closing,
			)
		)
			throw new Error('capture_conflict');
		if (!this.media.getTranscriptionRoom(roomId))
			throw new Error('room_missing');
		if (
			!Number.isSafeInteger(maxDurationMs) ||
			maxDurationMs < 1000 ||
			maxDurationMs > 14400000
		)
			throw new Error('invalid_duration');
		const c: Capture = {
			speechContext: {
				...(this.media.getTranscriptionRoom(roomId)?.speechContext ?? {
					vocabulary_version: LEGACY_VOCABULARY_VERSION,
					title: '',
				}),
			},
			participantNames: [],
			site,
			room,
			capture: id,
			started_at: new Date().toISOString(),
			state: 'capturing',
			epoch: performance.now(),
			maxDurationMs,
			recorderOrigin,
			token,
			gaps: [],
			sources: new Map(),
			seen: new Set(),
			polling: false,
			lastHeartbeat: performance.now(),
		};
		this.captures.set(key, c);
		try {
			const begun = await fetch(
				`${recorderOrigin}/v1/transcriptions/${encodeURIComponent(id)}/begin`,
				{
					method: 'POST',
					headers: {
						authorization: `Bearer ${token}`,
						'content-type': 'application/json',
					},
					body: JSON.stringify({
						started_at: c.started_at,
						speech_context: c.speechContext,
					}),
					signal: AbortSignal.timeout(10000),
					redirect: 'error',
				},
			);
			if (!begun.ok) throw new Error('source_start_failed');
			await this.poll(c);
			if (c.state !== 'capturing') throw new Error('capture_unavailable');
		} catch (error) {
			await this.stop(site, id, 'source_interrupted');
			throw error;
		}
		c.timer = setInterval(() => {
			void this.poll(c)
				.catch(() => this.stop(site, id, 'source_interrupted'))
				.catch(() => {});
		}, 500);
		c.timer.unref();
		this.notify(roomId, this.query(site, id));
		return this.query(site, id);
	}
	private async poll(c: Capture): Promise<void> {
		if (c.polling || c.closing || c.state !== 'capturing') return;
		c.polling = true;
		try {
			const roomId = this.key(c.site, c.room);
			const room = this.media.getTranscriptionRoom(roomId);
			const humans =
				room &&
				[...room.peers.values()].filter(
					(p) =>
						!p.id.startsWith('preview-') &&
						!p.info.userId?.startsWith('recorder:'),
				);
			if (!humans?.length) {
				void this.stop(c.site, c.capture, 'room_empty').catch(() => {});
				return;
			}
			if (performance.now() - c.epoch >= c.maxDurationMs) {
				void this.stop(c.site, c.capture, 'duration_limit').catch(() => {});
				return;
			}
			if (performance.now() - c.lastHeartbeat >= 5000) {
				c.lastHeartbeat = performance.now();
				const heartbeat = await fetch(
					`${c.recorderOrigin}/v1/transcriptions/${encodeURIComponent(c.capture)}/capture-state`,
					{
						headers: { authorization: `Bearer ${c.token}` },
						signal: AbortSignal.timeout(5000),
						redirect: 'error',
					},
				);
				const heartbeatState: unknown = await heartbeat.json();
				if (
					!heartbeat.ok ||
					!heartbeatState ||
					typeof heartbeatState !== 'object' ||
					!('state' in heartbeatState) ||
					heartbeatState.state !== 'capturing'
				)
					throw new Error('recorder_unavailable');
			}

			const names = participantHintNames([
				...c.participantNames,
				...humans.map((p) => p.info.name ?? ''),
			]);
			if (JSON.stringify(names) !== JSON.stringify(c.participantNames)) {
				const saved = await fetch(
					`${c.recorderOrigin}/v1/transcriptions/${encodeURIComponent(c.capture)}/participants`,
					{
						method: 'POST',
						headers: {
							authorization: `Bearer ${c.token}`,
							'content-type': 'application/json',
						},
						body: JSON.stringify({ names }),
						signal: AbortSignal.timeout(5000),
						redirect: 'error',
					},
				);
				if (!saved.ok) throw new Error('participant_hints_unavailable');
				c.participantNames = names;
			}
			for (const [producerId, source] of c.sources) {
				source.flushIdle();
				const producer = humans
					.flatMap((p) => [...p.producers.values()])
					.find((p) => p.id === producerId);
				if (!producer || producer.closed) {
					await source.stop();
					c.sources.delete(producerId);
				}
			}
			for (const peer of humans)
				for (const producer of peer.producers.values()) {
					if (
						producer.kind !== 'audio' ||
						producer.closed ||
						producer.appData.isScreen ||
						c.seen.has(producer.id)
					)
						continue;
					c.seen.add(producer.id);
					const source = new SourceCapture({
						capture: c.capture,
						speakerId: peer.info.userId ?? peer.id,
						speakerName: (peer.info.name?.trim() || 'Participant').slice(
							0,
							200,
						),
						producer,
						router: room!.router,
						epoch: c.epoch,
						maxDurationMs: c.maxDurationMs,
						recorderOrigin: c.recorderOrigin,
						token: c.token,
						onFailure: (gap) => {
							c.gaps.push(gap);
							this.notify(roomId, {
								...this.query(c.site, c.capture),
								interrupted: true,
							});
							void this.stop(c.site, c.capture, 'source_interrupted').catch(
								() => {},
							);
						},
					});
					c.sources.set(producer.id, source);
					await source.start();
				}
		} finally {
			c.polling = false;
		}
	}
	async stop(site: string, id: string, reason = 'stopped'): Promise<void> {
		const c = this.captures.get(this.key(site, id));
		if (!c) return;
		if (c.closing) return c.closing;
		c.closing = (async () => {
			if (c.timer) clearInterval(c.timer);
			const ended = Math.min(
				c.maxDurationMs,
				Math.max(1, Math.round(performance.now() - c.epoch)),
			);
			if (
				['source_interrupted', 'service_shutdown'].includes(reason) &&
				!c.gaps.length
			)
				c.gaps.push({
					start_ms:
						reason === 'source_interrupted' ? 0 : Math.max(0, ended - 1),
					end_ms: ended,
					reason,
				});
			await Promise.all([...c.sources.values()].map((s) => s.stop()));
			c.sources.clear();
			c.ended_at = new Date().toISOString();
			c.state = c.gaps.length ? 'partial' : 'complete';
			this.notify(this.key(site, c.room), this.query(site, id));
			const response = await fetch(
				`${c.recorderOrigin}/v1/transcriptions/${encodeURIComponent(c.capture)}/complete`,
				{
					method: 'POST',
					headers: {
						authorization: `Bearer ${c.token}`,
						'content-type': 'application/json',
					},
					body: JSON.stringify({ gaps: c.gaps }),
					signal: AbortSignal.timeout(10000),
					redirect: 'error',
				},
			);
			if (!response.ok) throw new Error('source_completion_failed');
			this.notify(this.key(site, c.room), this.query(site, id));
			// Keep terminal state briefly for idempotent stop/query; backend's durable source manifest owns recovery.
			const expiry = setTimeout(
				() => this.captures.delete(this.key(site, id)),
				600000,
			);
			expiry.unref();
		})();
		return c.closing;
	}
	async close(): Promise<void> {
		await Promise.allSettled(
			[...this.captures.values()]
				.filter((c) => c.state === 'capturing')
				.map((c) => this.stop(c.site, c.capture, 'service_shutdown')),
		);
	}
}
