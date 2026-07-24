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
	readonly authEvents = new Counter({
		name: 'meet_sfu_auth_events_total',
		help: 'Authentication and token lifecycle outcomes',
		labelNames: ['stage', 'reason', 'outcome'] as const,
		registers: [this.registry],
	});
	readonly e2eeEvents = new Counter({
		name: 'meet_sfu_e2ee_events_total',
		help: 'Bounded E2EE protocol events and rejections',
		labelNames: ['event', 'outcome'] as const,
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
	readonly transportStateChanges = new Counter({
		name: 'meet_sfu_transport_state_changes_total',
		help: 'WebRTC transport ICE and DTLS state transitions',
		labelNames: ['protocol', 'direction', 'state'] as const,
		registers: [this.registry],
	});
	readonly mediaOperations = new Counter({
		name: 'meet_sfu_media_operations_total',
		help: 'Producer and consumer creation outcomes',
		labelNames: [
			'operation',
			'direction',
			'media',
			'source',
			'outcome',
		] as const,
		registers: [this.registry],
	});
	readonly mediaOperationDuration = new Histogram({
		name: 'meet_sfu_media_operation_duration_seconds',
		help: 'Producer and consumer creation duration',
		labelNames: [
			'operation',
			'direction',
			'media',
			'source',
			'outcome',
		] as const,
		buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
		registers: [this.registry],
	});
	readonly clientEvents = new Counter({
		name: 'meet_sfu_client_events_total',
		help: 'Accepted sampled browser outcome events',
		labelNames: ['event'] as const,
		registers: [this.registry],
	});
	readonly clientEventsRejected = new Counter({
		name: 'meet_sfu_client_events_rejected_total',
		help: 'Rejected browser telemetry events',
		labelNames: ['reason'] as const,
		registers: [this.registry],
	});
	readonly firstRemoteMediaDuration = new Histogram({
		name: 'meet_sfu_first_remote_media_duration_seconds',
		help: 'Time from meeting connection setup to first remote media',
		labelNames: ['media'] as const,
		buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60],
		registers: [this.registry],
	});
	readonly clientMediaStalls = new Counter({
		name: 'meet_sfu_client_media_stalls_total',
		help: 'Sampled browser-detected receive stalls',
		labelNames: ['media'] as const,
		registers: [this.registry],
	});
	readonly clientRecoveries = new Counter({
		name: 'meet_sfu_client_recoveries_total',
		help: 'Sampled browser recovery outcomes',
		labelNames: ['direction', 'trigger', 'outcome'] as const,
		registers: [this.registry],
	});
	readonly clientRecoveryDuration = new Histogram({
		name: 'meet_sfu_client_recovery_duration_seconds',
		help: 'Sampled browser recovery duration',
		labelNames: ['direction', 'trigger', 'outcome'] as const,
		buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60],
		registers: [this.registry],
	});
	readonly clientRecoveryExhausted = new Counter({
		name: 'meet_sfu_client_recovery_exhausted_total',
		help: 'Sampled browser recoveries that exhausted all fallbacks',
		labelNames: ['subsystem', 'direction', 'reason'] as const,
		registers: [this.registry],
	});
	readonly clientRtt = new Histogram({
		name: 'meet_sfu_client_rtt_seconds',
		help: 'Sampled browser WebRTC round-trip time',
		buckets: [0.025, 0.05, 0.1, 0.2, 0.45, 0.9, 1.5, 3, 10, 60],
		registers: [this.registry],
	});
	readonly clientPacketLoss = new Histogram({
		name: 'meet_sfu_client_packet_loss_ratio',
		help: 'Sampled browser WebRTC packet loss ratio',
		buckets: [0, 0.01, 0.03, 0.05, 0.08, 0.18, 0.3, 0.5, 1],
		registers: [this.registry],
	});
	readonly clientAvailableOutgoingBitrate = new Histogram({
		name: 'meet_sfu_client_available_outgoing_bitrate_bps',
		help: 'Sampled browser available outgoing bitrate',
		buckets: [
			50_000, 100_000, 200_000, 350_000, 500_000, 1_000_000, 2_500_000,
			5_000_000, 10_000_000,
		],
		registers: [this.registry],
	});
	readonly mediaScore = new Histogram({
		name: 'meet_sfu_media_score',
		help: 'mediasoup producer and consumer score observations',
		labelNames: ['direction', 'media'] as const,
		buckets: [0, 2, 4, 6, 8, 10],
		registers: [this.registry],
	});
	private workerCpu = new Gauge({
		name: 'meet_sfu_worker_cpu_seconds',
		help: 'Aggregate mediasoup worker CPU time',
		labelNames: ['mode'] as const,
		registers: [this.registry],
	});
	private workerMemory = new Gauge({
		name: 'meet_sfu_worker_max_resident_memory_bytes',
		help: 'Aggregate mediasoup worker maximum resident memory',
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

	recordTransportState(labels: {
		protocol: 'ice' | 'dtls';
		direction: 'send' | 'recv';
		state: string;
	}): void {
		const states =
			labels.protocol === 'ice'
				? new Set(['new', 'connected', 'completed', 'disconnected', 'closed'])
				: new Set(['new', 'connecting', 'connected', 'failed', 'closed']);
		this.transportStateChanges.inc({
			...labels,
			state: states.has(labels.state) ? labels.state : 'unknown',
		});
	}

	recordMediaOperation(
		labels: {
			operation: 'create_producer' | 'create_consumer';
			direction: 'send' | 'recv';
			media: 'audio' | 'video' | 'unknown';
			source: 'camera' | 'screen' | 'unknown';
			outcome: Outcome;
		},
		durationSeconds: number,
	): void {
		this.mediaOperations.inc(labels);
		this.mediaOperationDuration.observe(labels, durationSeconds);
		loggers.telemetry.event('media_operation', {
			...labels,
			duration_ms: Math.round(durationSeconds * 1000),
		});
	}

	setResources(resources: Record<string, number>): void {
		for (const [resource, value] of Object.entries(resources)) {
			this.resources.set({ resource }, value);
		}
	}

	setWorkerResources(resources: {
		userCpuSeconds: number;
		systemCpuSeconds: number;
		maxResidentMemoryBytes: number;
	}): void {
		this.workerCpu.set({ mode: 'user' }, resources.userCpuSeconds);
		this.workerCpu.set({ mode: 'system' }, resources.systemCpuSeconds);
		this.workerMemory.set(resources.maxResidentMemoryBytes);
	}

	recordE2EEEvent(
		event: string,
		outcome: 'received' | 'rate_limited' | 'failure',
	): void {
		const known = new Set([
			'key-package-request',
			'key-package',
			'genesis-request',
			'join-status',
			'commit-request',
			'commit',
			'welcome',
			'ack',
			'resync-request',
		]);
		this.e2eeEvents.inc({
			event: known.has(event) ? event : 'unknown',
			outcome,
		});
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
