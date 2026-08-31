export type CaptureState =
	| 'capturing'
	| 'sealing'
	| 'complete'
	| 'partial'
	| 'failed';

export interface CaptureSegment {
	epoch: number;
	index: number;
	file: string;
	bytes: number;
	sha256: string;
	duration_ms: number;
	started_at: string;
}

export interface CaptureGap {
	started_at: string;
	ended_at?: string;
	reason: string;
}

export interface CaptureInterruption {
	id: string;
	detected_at: string;
	deadline: string;
	omission_started_at: string;
	reason: string;
}

export interface CaptureRecovery {
	id: string;
	capture_started_at: string;
	recovered_at: string;
}

export interface CaptureArtifact {
	file: string;
	bytes: number;
	sha256: string;
	duration_ms: number;
}

export interface CaptureManifest {
	version: 1;
	revision: number;
	job: string;
	state: CaptureState;
	epochs: number;
	segments: CaptureSegment[];
	gaps: CaptureGap[];
	artifact?: CaptureArtifact;
	reason?: string;
}

export interface MediaProbe {
	duration_ms: number;
	video: { codec: 'h264'; width: 1920; height: 1080; fps: 30 };
	audio: { codec: 'aac'; sample_rate: 48000; channels: 2 };
}

export interface MediaTools {
	validate(path: string, timeoutMs?: number): Promise<MediaProbe>;
}
