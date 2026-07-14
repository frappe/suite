import {
	Counter,
	collectDefaultMetrics,
	Gauge,
	Histogram,
	Registry,
} from 'prom-client';
import { loggers } from '../utils/logger';

export type TransportDirection = 'send' | 'recv' | 'unknown';
export type Outcome = 'success' | 'failure';

export class Telemetry {
	readonly registry = new Registry();
	readonly socketConnections = new Counter({
		name: 'meet_sfu_socket_connections_total',
		help: 'Authenticated Socket.IO connection attempts',
		labelNames: ['outcome'] as const,
		registers: [this.registry],
	});
	readonly socketDisconnects = new Counter({
		name: 'meet_sfu_socket_disconnects_total',
		help: 'Socket.IO disconnects by bounded reason',
		labelNames: ['reason'] as const,
		registers: [this.registry],
	});
	readonly roomJoins = new Counter({
		name: 'meet_sfu_room_joins_total',
		help: 'Room join attempts',
		labelNames: ['scope', 'rejoin', 'outcome'] as const,
		registers: [this.registry],
	});
	readonly roomJoinDuration = new Histogram({
		name: 'meet_sfu_room_join_duration_seconds',
		help: 'Room join duration',
		labelNames: ['scope', 'rejoin', 'outcome'] as const,
		buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
		registers: [this.registry],
	});
	readonly transportOperations = new Counter({
		name: 'meet_sfu_transport_operations_total',
		help: 'WebRTC transport operations',
		labelNames: ['operation', 'direction', 'outcome'] as const,
		registers: [this.registry],
	});
	readonly transportOperationDuration = new Histogram({
		name: 'meet_sfu_transport_operation_duration_seconds',
		help: 'WebRTC transport operation duration',
		labelNames: ['operation', 'direction', 'outcome'] as const,
		buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
		registers: [this.registry],
	});
	private resources = new Gauge({
		name: 'meet_sfu_resources',
		help: 'Current SFU resource counts',
		labelNames: ['resource'] as const,
		registers: [this.registry],
	});

	constructor() {
		collectDefaultMetrics({
			prefix: 'meet_sfu_process_',
			register: this.registry,
		});
	}

	recordRoomJoin(
		labels: { scope: string; rejoin: boolean; outcome: Outcome },
		durationSeconds: number,
	): void {
		const bounded = {
			scope: labels.scope === 'full' ? 'full' : 'presence-preview',
			rejoin: String(labels.rejoin),
			outcome: labels.outcome,
		};
		this.roomJoins.inc(bounded);
		this.roomJoinDuration.observe(bounded, durationSeconds);
		loggers.telemetry.event('room_join', {
			...bounded,
			duration_ms: Math.round(durationSeconds * 1000),
		});
	}

	recordTransportOperation(
		labels: {
			operation: 'create' | 'connect' | 'restart_ice';
			direction: TransportDirection;
			outcome: Outcome;
		},
		durationSeconds: number,
	): void {
		this.transportOperations.inc(labels);
		this.transportOperationDuration.observe(labels, durationSeconds);
		loggers.telemetry.event('transport_operation', {
			...labels,
			duration_ms: Math.round(durationSeconds * 1000),
		});
	}

	setResources(resources: Record<string, number>): void {
		for (const [resource, value] of Object.entries(resources)) {
			this.resources.set({ resource }, value);
		}
	}
}

export function normalizeDisconnectReason(reason: string): string {
	const knownReasons = new Set([
		'client namespace disconnect',
		'server namespace disconnect',
		'ping timeout',
		'transport close',
		'transport error',
		'parse error',
		'forced close',
		'forced server close',
	]);
	return knownReasons.has(reason) ? reason.replace(/ /g, '_') : 'other';
}

export function direction(value: unknown): TransportDirection {
	return value === 'send' || value === 'recv' ? value : 'unknown';
}
