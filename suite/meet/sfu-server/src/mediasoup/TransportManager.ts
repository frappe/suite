import type * as mediasoup from 'mediasoup';
import type {
	DtlsParameters,
	IceCandidate,
	IceParameters,
	TransportData,
	WebRTCTransportOptions,
	WebRtcTransport,
} from '../types';
import { loggers } from '../utils/logger';

interface WebRtcTransportParams {
	id: string;
	iceParameters: IceParameters;
	iceCandidates: IceCandidate[];
	dtlsParameters: DtlsParameters;
}

export class TransportManager {
	private transports = new Map<string, TransportData>();
	private pendingTransports = new Map<string, Promise<WebRtcTransportParams>>();
	private transportGenerations = new Map<string, number>();
	private stateListeners: Array<
		(event: {
			protocol: 'ice' | 'dtls';
			direction: 'send' | 'recv';
			state: string;
		}) => void
	> = [];

	onStateChange(
		listener: (event: {
			protocol: 'ice' | 'dtls';
			direction: 'send' | 'recv';
			state: string;
		}) => void,
	): void {
		this.stateListeners.push(listener);
	}

	async createWebRtcTransport(
		roomId: string,
		peerId: string,
		router: mediasoup.types.Router,
		webRtcServer: mediasoup.types.WebRtcServer,
		direction: 'send' | 'recv',
		options: WebRTCTransportOptions,
	): Promise<WebRtcTransportParams> {
		const key = `${roomId}:${peerId}:${direction}`;
		const pending = this.pendingTransports.get(key);
		if (pending) return pending;

		const generation = this.transportGenerations.get(key) ?? 0;
		let creation: Promise<WebRtcTransportParams>;
		creation = this.replaceWebRtcTransport(
			roomId,
			peerId,
			router,
			webRtcServer,
			direction,
			options,
			key,
			generation,
		).finally(() => {
			if (this.pendingTransports.get(key) === creation) {
				this.pendingTransports.delete(key);
			}
		});
		this.pendingTransports.set(key, creation);
		return creation;
	}

	private async replaceWebRtcTransport(
		roomId: string,
		peerId: string,
		router: mediasoup.types.Router,
		webRtcServer: mediasoup.types.WebRtcServer,
		direction: 'send' | 'recv',
		options: WebRTCTransportOptions,
		key: string,
		generation: number,
	): Promise<WebRtcTransportParams> {
		loggers.transportManager.info(
			'Creating %s transport for peer %s',
			direction,
			peerId,
		);
		if (direction === 'recv') {
			this.closePeerDirectionTransports(roomId, peerId, direction);
		}

		const transport = await router.createWebRtcTransport({
			webRtcServer,
			enableTcp: options.enableTcp,
			initialAvailableOutgoingBitrate: options.initialAvailableOutgoingBitrate,
		});
		if ((this.transportGenerations.get(key) ?? 0) !== generation) {
			transport.close();
			throw new Error(`Transport creation for peer ${peerId} was cancelled`);
		}
		transport.on('icestatechange', (state) => {
			this.emitState({ protocol: 'ice', direction, state });
		});
		transport.on('dtlsstatechange', (state) => {
			this.emitState({ protocol: 'dtls', direction, state });
		});

		const transportData: TransportData = {
			roomId,
			peerId,
			transport,
			direction,
		};
		this.transports.set(transport.id, transportData);
		transport.observer.on('close', () => {
			this.transports.delete(transport.id);
		});

		loggers.transportManager.info(
			'%s transport created for peer %s',
			direction,
			peerId,
		);

		return {
			id: transport.id,
			iceParameters: transport.iceParameters,
			iceCandidates: transport.iceCandidates,
			dtlsParameters: transport.dtlsParameters,
		};
	}

	private closePeerDirectionTransports(
		roomId: string,
		peerId: string,
		direction: 'send' | 'recv',
	): void {
		for (const [transportId, transportData] of this.transports) {
			if (
				transportData.roomId !== roomId ||
				transportData.peerId !== peerId ||
				transportData.direction !== direction
			) {
				continue;
			}
			transportData.transport.close();
			this.transports.delete(transportId);
		}
	}

	private emitState(event: {
		protocol: 'ice' | 'dtls';
		direction: 'send' | 'recv';
		state: string;
	}): void {
		for (const listener of this.stateListeners) listener(event);
	}

	async connectWebRtcTransport(
		transportId: string,
		dtlsParameters: DtlsParameters,
	): Promise<void> {
		const transportData = this.transports.get(transportId);
		if (!transportData) {
			throw new Error(`Transport ${transportId} not found`);
		}

		try {
			await transportData.transport.connect({ dtlsParameters });
		} catch (error) {
			loggers.transportManager.error(
				'Failed to connect transport %s: %s',
				transportId,
				(error as Error).message,
			);
			loggers.transportManager.error('Transport state on error: %o', {
				id: transportData.transport.id,
				iceState: transportData.transport.iceState,
				dtlsState: transportData.transport.dtlsState,
			});
			throw error;
		}
	}

	async restartWebRtcTransportIce(transportId: string): Promise<IceParameters> {
		const transportData = this.transports.get(transportId);
		if (!transportData) {
			throw new Error(`Transport ${transportId} not found`);
		}

		return transportData.transport.restartIce();
	}

	getTransport(transportId: string): WebRtcTransport | undefined {
		return this.transports.get(transportId)?.transport;
	}

	getTransportData(transportId: string): TransportData | undefined {
		return this.transports.get(transportId);
	}

	getTransportCount(): number {
		return this.transports.size;
	}

	closePeerTransports(roomId: string, peerId: string): void {
		for (const direction of ['send', 'recv'] as const) {
			const key = `${roomId}:${peerId}:${direction}`;
			this.transportGenerations.set(
				key,
				(this.transportGenerations.get(key) ?? 0) + 1,
			);
			this.pendingTransports.delete(key);
		}
		for (const [transportId, transportData] of this.transports) {
			if (transportData.roomId !== roomId || transportData.peerId !== peerId)
				continue;
			try {
				transportData.transport.close();
			} catch (error) {
				loggers.transportManager.warn(
					'Error closing transport %s: %s',
					transportId,
					(error as Error).message,
				);
			}
			this.transports.delete(transportId);
		}
	}

	cleanup(): void {
		for (const key of this.pendingTransports.keys()) {
			this.transportGenerations.set(
				key,
				(this.transportGenerations.get(key) ?? 0) + 1,
			);
		}
		this.pendingTransports.clear();
		for (const [transportId, transportData] of this.transports) {
			try {
				transportData.transport.close();
			} catch (error) {
				loggers.transportManager.warn(
					'Error closing transport %s: %s',
					transportId,
					(error as Error).message,
				);
			}
		}
		this.transports.clear();
	}

	async createPlainTransport(
		roomId: string,
		peerId: string,
		router: mediasoup.types.Router,
		listenIp: string,
		rtcpMux = true,
		comedia = true,
	): Promise<{
		id: string;
		ip: string;
		port: number;
		rtcpPort: number | undefined;
	}> {
		loggers.transportManager.info(
			'Creating PlainTransport for peer %s',
			peerId,
		);

		const transport = await router.createPlainTransport({
			listenInfo: { protocol: 'udp', ip: listenIp },
			rtcpMux,
			comedia,
		});

		const transportData: TransportData = {
			roomId,
			peerId,
			transport: transport as unknown as WebRtcTransport, // fake as WebRtcTransport
		};
		this.transports.set(transport.id, transportData);

		loggers.transportManager.info(
			'PlainTransport created for peer %s on port %d',
			peerId,
			transport.tuple.localPort,
		);

		return {
			id: transport.id,
			ip: transport.tuple.localIp,
			port: transport.tuple.localPort,
			rtcpPort: transport.rtcpTuple?.localPort,
		};
	}
}
