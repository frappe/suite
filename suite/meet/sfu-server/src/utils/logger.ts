import { format } from 'node:util';
import type { JsonValue } from '../types';

enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
}

class Logger {
	private component: string;
	private minLevel: LogLevel;

	constructor(component: string, minLevel: LogLevel = LogLevel.INFO) {
		this.component = component;
		this.minLevel = minLevel;
	}

	private formatMessage(
		level: string,
		message: string,
		...args: unknown[]
	): string {
		const timestamp = new Date().toISOString();
		const formattedMessage =
			args.length > 0 ? format(message, ...args) : message;
		return `[${timestamp}] [${level}] [${this.component}] ${formattedMessage}`;
	}

	private shouldLog(level: LogLevel): boolean {
		return level >= this.minLevel;
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.shouldLog(LogLevel.DEBUG)) {
			console.log(this.formatMessage('DEBUG', message, ...args));
		}
	}

	info(message: string, ...args: unknown[]): void {
		if (this.shouldLog(LogLevel.INFO)) {
			console.log(this.formatMessage('INFO', message, ...args));
		}
	}

	warn(message: string, ...args: unknown[]): void {
		if (this.shouldLog(LogLevel.WARN)) {
			console.warn(this.formatMessage('WARN', message, ...args));
		}
	}

	error(message: string, ...args: unknown[]): void {
		if (this.shouldLog(LogLevel.ERROR)) {
			console.error(this.formatMessage('ERROR', message, ...args));
		}
	}

	event(name: string, fields: { [key: string]: JsonValue } = {}): void {
		if (this.shouldLog(LogLevel.INFO)) {
			console.log(
				JSON.stringify({
					timestamp: new Date().toISOString(),
					level: 'info',
					component: this.component,
					event: name,
					...fields,
				}),
			);
		}
	}
}

function parseLogLevel(env?: string): LogLevel {
	if (!env) return LogLevel.INFO;
	switch (env.toLowerCase()) {
		case 'debug':
			return LogLevel.DEBUG;
		case 'info':
			return LogLevel.INFO;
		case 'warn':
			return LogLevel.WARN;
		case 'error':
			return LogLevel.ERROR;
		default:
			return LogLevel.INFO;
	}
}

const defaultLevel = parseLogLevel(process.env.SFU_LOG_LEVEL);

export const loggers = {
	workerManager: new Logger('WorkerManager', defaultLevel),
	roomManager: new Logger('RoomManager', defaultLevel),
	peerManager: new Logger('PeerManager', defaultLevel),
	transportManager: new Logger('TransportManager', defaultLevel),
	producerManager: new Logger('ProducerManager', defaultLevel),
	consumerManager: new Logger('ConsumerManager', defaultLevel),
	mediasoupManager: new Logger('MediasoupManager', defaultLevel),
	socketHandler: new Logger('SocketHandler', defaultLevel),
	authManager: new Logger('AuthManager', defaultLevel),
	server: new Logger('Server', defaultLevel),
	config: new Logger('Config', defaultLevel),
	telemetry: new Logger('Telemetry', defaultLevel),
} as const;
