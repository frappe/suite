import type * as mediasoup from 'mediasoup';
import type {
	ConsumerData,
	RtpCapabilities,
	RtpParameters,
	WebRtcTransport,
} from '../types';
import { loggers } from '../utils/logger';

export class ConsumerManager {
	private consumers = new Map<string, ConsumerData>();
	private scoreListeners: Array<
		(kind: 'audio' | 'video', score: number) => void
	> = [];
	private closeListeners: Array<(consumerData: ConsumerData) => void> = [];

	onScore(listener: (kind: 'audio' | 'video', score: number) => void): void {
		this.scoreListeners.push(listener);
	}

	onClose(listener: (consumerData: ConsumerData) => void): void {
		this.closeListeners.push(listener);
	}

	async createConsumer(
		transport: WebRtcTransport,
		producer: mediasoup.types.Producer,
		producerId: string,
		roomId: string,
		peerId: string,
		rtpCapabilities: RtpCapabilities,
	): Promise<{
		id: string;
		producerId: string;
		kind: 'audio' | 'video';
		rtpParameters: RtpParameters;
		paused: boolean;
	}> {
		// Validate transport is not closed or failed
		if (transport.closed) {
			throw new Error(
				`Transport ${transport.id} is closed - cannot create consumer`,
			);
		}

		if (transport.dtlsState === 'failed') {
			loggers.consumerManager.error('Transport %s DTLS failed', transport.id);
			throw new Error(`Transport ${transport.id} DTLS connection failed`);
		}

		if (transport.dtlsState === 'closed') {
			loggers.consumerManager.error('Transport %s DTLS closed', transport.id);
			throw new Error(`Transport ${transport.id} DTLS connection is closed`);
		}

		if (producer.closed) {
			throw new Error(
				`Producer ${producerId} is closed - cannot create consumer`,
			);
		}

		let createdConsumer: mediasoup.types.Consumer | undefined;
		try {
			const consumer = await transport.consume({
				producerId,
				rtpCapabilities,
				paused: true, // Consumers should start paused by default
			});
			createdConsumer = consumer;

			const consumerData: ConsumerData = {
				roomId,
				peerId,
				transportId: transport.id,
				consumer,
			};
			this.consumers.set(consumer.id, consumerData);
			consumer.on('transportclose', () => {
				this.removeConsumer(consumer.id, false);
			});
			consumer.on('score', (score) => {
				for (const listener of this.scoreListeners) {
					listener(consumer.kind, score.score);
				}
			});

			loggers.consumerManager.info(
				'Consumer %s (%s) created for peer %s from producer %s',
				consumer.id,
				consumer.kind,
				peerId,
				producerId,
			);

			if (consumer.paused) {
				await consumer.resume();
			}

			if (consumer.kind === 'video') {
				// Fire-and-forget. PLI/RPLI is a UDP-side signal to the producer;
				// awaiting it blocks createConsumer's return on the mediasoup
				// internal round-trip with no observable benefit. Errors are
				// logged but do not affect consumer readiness.
				consumer
					.requestKeyFrame()
					.then(() => {
						loggers.consumerManager.debug(
							'Initial key frame requested for consumer %s',
							consumer.id,
						);
					})
					.catch((error) => {
						loggers.consumerManager.warn(
							'Failed to request key frame for consumer %s: %s',
							consumer.id,
							(error as Error).message,
						);
					});
			}

			return {
				id: consumer.id,
				producerId,
				kind: consumer.kind,
				rtpParameters: consumer.rtpParameters,
				paused: consumer.paused,
			};
		} catch (consumeError) {
			if (createdConsumer) this.removeConsumer(createdConsumer.id, true);
			loggers.consumerManager.error('Failed to create consumer: %o', {
				error: (consumeError as Error).message,
				producerId,
				transportId: transport.id,
				transportState: transport.dtlsState,
				producerKind: producer.kind,
				producerClosed: producer.closed,
			});
			throw consumeError;
		}
	}

	closeConsumer(consumerId: string): void {
		this.removeConsumer(consumerId, true);
	}

	private removeConsumer(consumerId: string, close: boolean): void {
		const consumerData = this.consumers.get(consumerId);
		if (!consumerData) return;

		const { consumer } = consumerData;
		this.consumers.delete(consumerId);

		if (close) {
			try {
				consumer.close();
			} catch (error) {
				loggers.consumerManager.warn(
					'Error closing consumer %s: %s',
					consumerId,
					(error as Error).message,
				);
			}
		}

		for (const listener of this.closeListeners) listener(consumerData);

		loggers.consumerManager.info('Consumer closed: %s', consumerId);
	}

	getConsumer(consumerId: string): mediasoup.types.Consumer | undefined {
		return this.consumers.get(consumerId)?.consumer;
	}

	getConsumerData(consumerId: string): ConsumerData | undefined {
		return this.consumers.get(consumerId);
	}

	getConsumersByProducer(producerId: string): ConsumerData[] {
		return Array.from(this.consumers.values()).filter(
			(c) => c.consumer.producerId === producerId,
		);
	}
	getConsumersByPeer(roomId: string, peerId: string): ConsumerData[] {
		return Array.from(this.consumers.values()).filter(
			(c) => c.roomId === roomId && c.peerId === peerId,
		);
	}

	async requestConsumerKeyFrame(consumerId: string): Promise<boolean> {
		const consumerData = this.consumers.get(consumerId);
		if (!consumerData || consumerData.consumer.kind !== 'video') {
			return false;
		}

		try {
			await consumerData.consumer.requestKeyFrame();
			return true;
		} catch (error) {
			loggers.consumerManager.warn(
				'Failed to request key frame for consumer %s: %s',
				consumerId,
				(error as Error).message,
			);
			return false;
		}
	}

	getConsumerCount(): number {
		return this.consumers.size;
	}

	async pauseConsumer(consumerId: string): Promise<boolean> {
		const consumerData = this.consumers.get(consumerId);
		if (!consumerData) {
			return false;
		}

		const { consumer } = consumerData;
		if (consumer.paused) {
			return false;
		}

		try {
			await consumer.pause();
			return true;
		} catch (error) {
			loggers.consumerManager.warn(
				'Failed to pause consumer %s: %s',
				consumerId,
				(error as Error).message,
			);
			return false;
		}
	}

	async resumeConsumer(consumerId: string): Promise<boolean> {
		const consumerData = this.consumers.get(consumerId);
		if (!consumerData) {
			return false;
		}

		const { consumer } = consumerData;
		if (!consumer.paused) {
			return false;
		}

		try {
			await consumer.resume();
			return true;
		} catch (error) {
			loggers.consumerManager.warn(
				'Failed to resume consumer %s: %s',
				consumerId,
				(error as Error).message,
			);
			return false;
		}
	}

	async setConsumerPreferredLayers(
		consumerId: string,
		spatialLayer: number,
		temporalLayer?: number | null,
	): Promise<{
		spatialLayer: number;
		temporalLayer: number;
	} | null> {
		const consumerData = this.consumers.get(consumerId);
		if (!consumerData) {
			return null;
		}

		const { consumer } = consumerData;

		const currentPreferred = consumer.preferredLayers || null;
		const temporalValue =
			temporalLayer || (currentPreferred?.temporalLayer ?? 2);

		await consumer.setPreferredLayers({
			spatialLayer,
			temporalLayer: temporalValue,
		});

		return {
			spatialLayer,
			temporalLayer: temporalValue,
		};
	}

	closePeerConsumers(roomId: string, peerId: string): void {
		for (const [consumerId, consumerData] of this.consumers) {
			if (consumerData.roomId !== roomId || consumerData.peerId !== peerId)
				continue;
			this.closeConsumer(consumerId);
		}
	}

	cleanup(): void {
		for (const consumerId of Array.from(this.consumers.keys())) {
			this.closeConsumer(consumerId);
		}
	}
}
