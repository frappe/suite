export type LogEvent =
	| 'request'
	| 'authorization_rejected'
	| 'job_reservation'
	| 'job_grant'
	| 'job_stop'
	| 'interruption_callback_failed'
	| 'recovery_callback_failed'
	| 'startup_callback_failed'
	| 'replacement_ready_callback_failed'
	| 'service_error';

export interface LogEntry {
	event: LogEvent;
	status?: string;
	reason?: string;
	method?: string;
	route?: string;
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
