import { describe, expect, it } from 'vitest';
import { parseClientTelemetry } from '../ClientTelemetryHandlers';

describe('parseClientTelemetry', () => {
	it('accepts fixed browser outcome schemas', () => {
		expect(
			parseClientTelemetry({
				event: 'recovery',
				direction: 'recv',
				trigger: 'stall',
				outcome: 'success',
				durationMs: 1200,
			}),
		).toEqual({
			event: 'recovery',
			direction: 'recv',
			trigger: 'stall',
			outcome: 'success',
			durationMs: 1200,
		});
	});

	it('rejects extra fields and unbounded values', () => {
		expect(
			parseClientTelemetry({
				event: 'media_stall',
				media: 'video',
				meetingId: 'secret',
			}),
		).toBeNull();
		expect(
			parseClientTelemetry({
				event: 'first_remote_media',
				media: 'screen',
				durationMs: Number.POSITIVE_INFINITY,
			}),
		).toBeNull();
	});

	it('accepts bounded recovery exhaustion outcomes', () => {
		expect(
			parseClientTelemetry({
				event: 'recovery_exhausted',
				subsystem: 'consumer',
				direction: 'recv',
				reason: 'retry_limit',
			}),
		).toEqual({
			event: 'recovery_exhausted',
			subsystem: 'consumer',
			direction: 'recv',
			reason: 'retry_limit',
		});
	});

	it('validates sampled network quality values', () => {
		expect(
			parseClientTelemetry({
				event: 'network_quality',
				rttMs: 100,
				packetLossPercent: 2,
				availableOutgoingBitrate: 500_000,
			}),
		).not.toBeNull();
		expect(
			parseClientTelemetry({
				event: 'network_quality',
				rttMs: -1,
				packetLossPercent: 2,
				availableOutgoingBitrate: 500_000,
			}),
		).toBeNull();
	});

	it('accepts bounded expected-media repair outcomes', () => {
		expect(
			parseClientTelemetry({
				event: 'media_repair',
				media: 'video',
				source: 'remote',
				stage: 'subscription',
				action: 'subscribe',
				attempt: 1,
				outcome: 'success',
				durationMs: 500,
			}),
		).not.toBeNull();
		expect(
			parseClientTelemetry({
				event: 'media_repair',
				media: 'video',
				source: 'remote',
				stage: 'subscription',
				action: 'subscribe',
				attempt: 4,
				outcome: 'success',
				durationMs: 500,
			}),
		).toBeNull();
	});
});
