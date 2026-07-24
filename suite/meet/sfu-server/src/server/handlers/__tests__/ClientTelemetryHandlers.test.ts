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
});
