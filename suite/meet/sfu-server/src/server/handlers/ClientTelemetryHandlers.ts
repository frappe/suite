import type { ClientTelemetryEvent } from '../../types';
import type { HandlerDeps } from './Handler';

const MAX_DURATION_MS = 5 * 60 * 1000;

export function registerClientTelemetryHandlers(deps: HandlerDeps) {
	return (socket: import('socket.io').Socket) => {
		socket.on('client_telemetry', (data: unknown) => {
			try {
				deps.authManager.ensureFullAccess(socket);
			} catch {
				deps.telemetry.clientEventsRejected.inc({ reason: 'scope' });
				return;
			}
			if (
				!deps.rateLimiter.checkRateLimit(
					`client-telemetry:${socket.id}`,
					60,
					60_000,
				)
			) {
				deps.telemetry.clientEventsRejected.inc({ reason: 'rate_limit' });
				return;
			}

			const event = parseClientTelemetry(data);
			if (!event) {
				deps.telemetry.clientEventsRejected.inc({ reason: 'invalid_schema' });
				return;
			}

			deps.telemetry.clientEvents.inc({ event: event.event });
			switch (event.event) {
				case 'first_remote_media':
					deps.telemetry.firstRemoteMediaDuration.observe(
						{ media: event.media },
						event.durationMs / 1000,
					);
					break;
				case 'media_stall':
					deps.telemetry.clientMediaStalls.inc({ media: event.media });
					break;
				case 'recovery': {
					const labels = {
						direction: event.direction,
						trigger: event.trigger,
						outcome: event.outcome,
					};
					deps.telemetry.clientRecoveries.inc(labels);
					deps.telemetry.clientRecoveryDuration.observe(
						labels,
						event.durationMs / 1000,
					);
					break;
				}
				case 'recovery_exhausted':
					deps.telemetry.clientRecoveryExhausted.inc({
						subsystem: event.subsystem,
						direction: event.direction,
						reason: event.reason,
					});
					break;
				case 'network_quality':
					deps.telemetry.clientRtt.observe(event.rttMs / 1000);
					deps.telemetry.clientPacketLoss.observe(
						event.packetLossPercent / 100,
					);
					deps.telemetry.clientAvailableOutgoingBitrate.observe(
						event.availableOutgoingBitrate,
					);
					break;
				case 'media_repair': {
					const labels = {
						media: event.media,
						source: event.source,
						stage: event.stage,
						action: event.action,
						outcome: event.outcome,
					};
					deps.telemetry.clientMediaRepairs.inc(labels);
					deps.telemetry.clientMediaRepairDuration.observe(
						labels,
						event.durationMs / 1000,
					);
					break;
				}
			}
		});
	};
}

export function parseClientTelemetry(
	data: unknown,
): ClientTelemetryEvent | null {
	if (!isRecord(data) || typeof data.event !== 'string') return null;
	if (data.event === 'media_stall') {
		return hasOnlyKeys(data, ['event', 'media']) && isMedia(data.media)
			? { event: data.event, media: data.media }
			: null;
	}
	if (data.event === 'first_remote_media') {
		return hasOnlyKeys(data, ['event', 'media', 'durationMs']) &&
			isMedia(data.media) &&
			isDuration(data.durationMs)
			? { event: data.event, media: data.media, durationMs: data.durationMs }
			: null;
	}
	if (data.event === 'recovery') {
		return hasOnlyKeys(data, [
			'event',
			'direction',
			'trigger',
			'outcome',
			'durationMs',
		]) &&
			(data.direction === 'send' ||
				data.direction === 'recv' ||
				data.direction === 'both') &&
			(data.trigger === 'signaling' ||
				data.trigger === 'ice' ||
				data.trigger === 'stall') &&
			(data.outcome === 'success' || data.outcome === 'failure') &&
			isDuration(data.durationMs)
			? {
					event: data.event,
					direction: data.direction,
					trigger: data.trigger,
					outcome: data.outcome,
					durationMs: data.durationMs,
				}
			: null;
	}
	if (data.event === 'recovery_exhausted') {
		return hasOnlyKeys(data, ['event', 'subsystem', 'direction', 'reason']) &&
			(data.subsystem === 'signaling' ||
				data.subsystem === 'transport' ||
				data.subsystem === 'consumer') &&
			(data.direction === 'send' ||
				data.direction === 'recv' ||
				data.direction === 'both') &&
			(data.reason === 'retry_limit' ||
				data.reason === 'restart_failed' ||
				data.reason === 'rebuild_failed')
			? {
					event: data.event,
					subsystem: data.subsystem,
					direction: data.direction,
					reason: data.reason,
				}
			: null;
	}
	if (data.event === 'network_quality') {
		return hasOnlyKeys(data, [
			'event',
			'rttMs',
			'packetLossPercent',
			'availableOutgoingBitrate',
		]) &&
			isBoundedNumber(data.rttMs, 60_000) &&
			isBoundedNumber(data.packetLossPercent, 100) &&
			isBoundedNumber(data.availableOutgoingBitrate, 100_000_000)
			? {
					event: data.event,
					rttMs: data.rttMs,
					packetLossPercent: data.packetLossPercent,
					availableOutgoingBitrate: data.availableOutgoingBitrate,
				}
			: null;
	}
	if (data.event === 'media_repair') {
		return hasOnlyKeys(data, [
			'event',
			'media',
			'source',
			'stage',
			'action',
			'attempt',
			'outcome',
			'durationMs',
		]) &&
			isMedia(data.media) &&
			['camera', 'microphone', 'screen', 'remote'].includes(
				String(data.source),
			) &&
			['capture', 'publication', 'subscription', 'rtp', 'decode'].includes(
				String(data.stage),
			) &&
			[
				'reacquire',
				'recreate_producer',
				'subscribe',
				'recreate_consumer',
				'request_keyframe',
			].includes(String(data.action)) &&
			Number.isInteger(data.attempt) &&
			(data.attempt as number) >= 1 &&
			(data.attempt as number) <= 3 &&
			['success', 'failure', 'exhausted', 'cancelled'].includes(
				String(data.outcome),
			) &&
			isDuration(data.durationMs)
			? (data as ClientTelemetryEvent)
			: null;
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
	return (
		Object.keys(value).length === keys.length &&
		Object.keys(value).every((key) => keys.includes(key))
	);
}

function isMedia(value: unknown): value is 'audio' | 'video' {
	return value === 'audio' || value === 'video';
}

function isDuration(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= MAX_DURATION_MS
	);
}

function isBoundedNumber(value: unknown, maximum: number): value is number {
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= maximum
	);
}
