export const COMMAND_AUDIENCE = 'meet-recorder-control';
export const COMMAND_TYPE = 'meet-recorder-command+jwt';
export const HEALTH_AUDIENCE = 'meet-recorder-health';
export const HEALTH_TYPE = 'meet-recorder-health+jwt';
export const PROTOCOL_VERSION = 1;
export type CommandOperation = 'reserve' | 'query' | 'grant' | 'stop';
export type CommandRejectionReason =
	| 'capacity'
	| 'storage'
	| 'readiness'
	| 'recovery_required'
	| 'policy'
	| 'invalid_request'
	| 'invalid_job';
export type DeploymentReadinessReason =
	| 'ready'
	| 'ledger_unavailable'
	| 'renderer_unavailable'
	| 'recovery_required'
	| 'storage_unavailable';

export interface RecordingPolicy {
	recording_allowed: boolean;
}

export interface RecordingLimits {
	budget_bytes: number;
	max_ends_at: string;
	output: { width: 1920; height: 1080; fps: 30; video: 'h264'; audio: 'aac' };
}

export interface CommandClaims {
	protocol_version: typeof PROTOCOL_VERSION;
	iss: string;
	aud: typeof COMMAND_AUDIENCE;
	site: string;
	origin: string;
	room: string;
	recording: string;
	job: string;
	operation: CommandOperation;
	limits: RecordingLimits;
	policy: RecordingPolicy;
	jti: string;
	iat: number;
	exp: number;
}

export interface HealthClaims {
	protocol_version: typeof PROTOCOL_VERSION;
	iss: string;
	aud: typeof HEALTH_AUDIENCE;
	site: string;
	origin: string;
	operation: 'deployment_health';
	jti: string;
	iat: number;
	exp: number;
}

export interface DeploymentHealthResponse {
	protocol_version: typeof PROTOCOL_VERSION;
	observed_at: string;
	ready: boolean;
	reason_code: DeploymentReadinessReason;
	configured_capacity: number;
	active_count: number;
	available_count: number;
}

export interface PublicJwk {
	kty: 'EC';
	crv: 'P-256';
	x: string;
	y: string;
}

export type JobState =
	| 'reserved'
	| 'configured'
	| 'proof_complete'
	| 'joined'
	| 'capture_ready'
	| 'interrupted'
	| 'failed'
	| 'recovery_required'
	| 'stopping'
	| 'complete'
	| 'partial';

export interface JobRecord {
	job: string;
	site: string;
	origin: string;
	room: string;
	recording: string;
	limits: RecordingLimits;
	accepted_at: string;
	configured_at?: string;
	proof_completed_at?: string;
	joined_at?: string;
	capture_started_at?: string;
	interruption_id?: string;
	interrupted_at?: string;
	interruption_deadline?: string;
	omission_started_at?: string;
	resumed_capture_started_at?: string;
	recovered_at?: string;
	public_jwk: PublicJwk;
	endpoint_generation: number;
	replacement_ready_at?: string;
	state: JobState;
	event_sequence?: number;
	health_reason?: string;
	terminal_at?: string;
	finalization_started_at?: string;
	cleanup_authorized_at?: string;
	cleanup_result?: 'Ready' | 'Partial' | 'Failed';
	local_deleted_at?: string;
	callback_completed_at?: string;
	captured_bytes?: number;
	artifact?: {
		state: 'complete' | 'partial';
		path: string;
		bytes?: number;
		sha256?: string;
		duration_ms?: number;
		gaps?: Array<{ started_at: string; ended_at?: string; reason: string }>;
	};
	stop_operation_ids: string[];
}
