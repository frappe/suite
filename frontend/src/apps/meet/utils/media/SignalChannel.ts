/**
 * SignalChannel
 * Transport seam between SFU domain logic and raw socket implementation.
 * One adapter = hypothetical seam. Two adapters = real seam.
 */

import { io, type Socket } from "socket.io-client";

interface SignalChannelConfig {
	origin: string;
	path: string;
	auth: { token: string };
	reconnection?: boolean;
	reconnectionAttempts?: number;
	reconnectionDelay?: number;
	reconnectionDelayMax?: number;
	transports?: string[];
	timeout?: number;
}

export interface SignalChannel {
	connect(config: SignalChannelConfig): Promise<void>;
	disconnect(): void;
	emit(
		event: string,
		data: unknown,
		callback?: (response: unknown) => void,
	): void;
	on(event: string, handler: (...args: unknown[]) => void): void;
	off(event: string, handler?: (...args: unknown[]) => void): void;
	isConnected(): boolean;
	id(): string | null;
	updateAuth(token: string): void;
}

export class SocketIOSignalChannel implements SignalChannel {
	private socket: Socket | null = null;

	async connect(config: SignalChannelConfig): Promise<void> {
		this.socket = io(config.origin, {
			path: config.path,
			auth: config.auth,
			reconnection:
				config.reconnection === undefined ? true : config.reconnection,
			reconnectionAttempts:
				config.reconnectionAttempts === undefined
					? 5
					: config.reconnectionAttempts,
			reconnectionDelay:
				config.reconnectionDelay === undefined
					? 1000
					: config.reconnectionDelay,
			reconnectionDelayMax:
				config.reconnectionDelayMax === undefined
					? 5000
					: config.reconnectionDelayMax,
			upgrade: true,
			transports: config.transports || ["websocket", "polling"],
			timeout: config.timeout || 20000,
			forceNew: true,
			withCredentials: false,
		});

		return new Promise<void>((resolve, reject) => {
			const onConnect = () => resolve();
			const onConnectError = (error: Error) => {
				this.socket?.off("connect", onConnect);
				reject(error);
			};
			this.socket?.once("connect", onConnect);
			this.socket?.once("connect_error", onConnectError);

			// Safety timeout
			setTimeout(() => {
				if (!this.isConnected()) {
					this.socket?.off("connect", onConnect);
					this.socket?.off("connect_error", onConnectError);
					reject(new Error("SignalChannel connection timeout"));
				}
			}, 10000);
		});
	}

	disconnect(): void {
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
	}

	emit(
		event: string,
		data: unknown,
		callback?: (response: unknown) => void,
	): void {
		if (!this.socket) {
			throw new Error("SignalChannel not connected");
		}
		if (callback) {
			this.socket.emit(event, data, callback);
		} else {
			this.socket.emit(event, data);
		}
	}

	on(event: string, handler: (...args: unknown[]) => void): void {
		if (!this.socket) return;
		this.socket.on(event, handler);
	}

	off(event: string, handler?: (...args: unknown[]) => void): void {
		if (!this.socket) return;
		if (handler) {
			this.socket.off(event, handler);
		} else {
			this.socket.off(event);
		}
	}

	isConnected(): boolean {
		return this.socket?.connected || false;
	}

	id(): string | null {
		return this.socket?.id || null;
	}

	updateAuth(token: string): void {
		if (!this.socket) return;
		(this.socket.auth as Record<string, unknown>).token = token;
		const ioOpts = this.socket.io?.opts as Record<string, unknown> | undefined;
		if (ioOpts && "auth" in ioOpts) {
			ioOpts.auth = {
				...((ioOpts.auth as Record<string, unknown> | undefined) || {}),
				token,
			};
		}
	}
}
