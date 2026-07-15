import { describe, expect, it } from 'vitest';
import { direction, normalizeDisconnectReason, Telemetry } from '../Telemetry';

describe('Telemetry', () => {
	it('exports bounded room and transport labels', async () => {
		const telemetry = new Telemetry();
		telemetry.recordRoomJoin(
			{ scope: 'unexpected-scope', rejoin: true, outcome: 'success' },
			0.25,
		);
		telemetry.recordTransportOperation(
			{ operation: 'restart_ice', direction: 'recv', outcome: 'failure' },
			0.5,
		);

		const output = await telemetry.registry.metrics();

		expect(output).toContain(
			'meet_sfu_room_joins_total{scope="presence-preview",rejoin="true",outcome="success"} 1',
		);
		expect(output).toContain(
			'meet_sfu_transport_operations_total{operation="restart_ice",direction="recv",outcome="failure"} 1',
		);
		expect(output).not.toContain('unexpected-scope');
	});

	it('normalizes unbounded external values', () => {
		expect(normalizeDisconnectReason('ping timeout')).toBe('ping_timeout');
		expect(normalizeDisconnectReason('arbitrary user-controlled reason')).toBe(
			'other',
		);
		expect(direction('send')).toBe('send');
		expect(direction('sideways')).toBe('unknown');
	});

	it('exports sampled browser outcomes without identifier labels', async () => {
		const telemetry = new Telemetry();
		telemetry.clientEvents.inc({ event: 'recovery' });
		telemetry.clientRecoveries.inc({
			direction: 'both',
			trigger: 'signaling',
			outcome: 'success',
		});

		const output = await telemetry.registry.metrics();

		expect(output).toContain(
			'meet_sfu_client_recoveries_total{direction="both",trigger="signaling",outcome="success"} 1',
		);
		expect(output).not.toMatch(/meetingId|participantId|socketId|transportId/);
	});
});
