type LogEvent =
	| 'request'
	| 'authorization_rejected'
	| 'job_reservation'
	| 'job_grant'
	| 'job_stop'
	| 'interruption_callback_failed'
	| 'recovery_callback_failed'
	| 'startup_callback_failed'
	| 'replacement_ready_callback_failed'
	| 'terminal_delivery_failed'
	| 'segment_progress_callback_failed'
	| 'capture_budget_check_failed'
	| 'capture_process_exited'
	| 'transcription_storage_unavailable'
	| 'transcription_retention_failed'
	| 'service_initialization_failed'
	| 'service_error';

export interface LogEntry {
	event: LogEvent;
	status?: string;
	reason?: string;
	method?: string;
	route?: string;
	job?: string;
	attempt?: number;
	exit_code?: number | null;
	signal?: NodeJS.Signals | null;
}

export interface Logger {
	info(entry: LogEntry): void;
	error(entry: LogEntry): void;
}

function write(level: 'info' | 'error', entry: LogEntry): void {
	process.stdout.write(
		`${JSON.stringify({ timestamp: new Date().toISOString(), level, ...entry })}\n`,
	);
}

export const logger: Logger = {
	info: (entry) => write('info', entry),
	error: (entry) => write('error', entry),
};
