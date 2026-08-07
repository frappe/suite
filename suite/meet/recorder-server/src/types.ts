export const COMMAND_AUDIENCE = 'meet-recorder-control';
export const COMMAND_TYPE = 'meet-recorder-command+jwt';
export type CommandOperation = 'reserve' | 'query' | 'grant' | 'stop';

export interface RecordingLimits {
	budget_bytes: number;
	max_ends_at: string;
	output: { width: 1920; height: 1080; fps: 30; video: 'h264'; audio: 'aac' };
}

export interface CommandClaims {
	iss: string;
	aud: typeof COMMAND_AUDIENCE;
	site: string;
	origin: string;
	room: string;
	recording: string;
	job: string;
	operation: CommandOperation;
	limits: RecordingLimits;
	jti: string;
	iat: number;
	exp: number;
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
	public_jwk: PublicJwk;
	state: JobState;
	health_reason?: string;
	terminal_at?: string;
	callback_completed_at?: string;
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
