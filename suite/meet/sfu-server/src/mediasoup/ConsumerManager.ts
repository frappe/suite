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

		try {
			const consumer = await transport.consume({
				producerId,
				rtpCapabilities,
				paused: true, // Consumers should start paused by default
			});

			const consumerData: ConsumerData = {
				roomId,
				peerId,
				consumer,
			};
			this.consumers.set(consumer.id, consumerData);

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

			return {
				id: consumer.id,
				producerId,
				kind: consumer.kind,
				rtpParameters: consumer.rtpParameters,
				paused: consumer.paused,
			};
		} catch (consumeError) {
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
		const consumerData = this.consumers.get(consumerId);
		if (!consumerData) return;

		const { consumer } = consumerData;

		try {
			consumer.close();
		} catch (error) {
			loggers.consumerManager.warn(
				'Error closing consumer %s: %s',
				consumerId,
				(error as Error).message,
			);
		}

		this.consumers.delete(consumerId);

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
		for (const [consumerId, consumerData] of this.consumers) {
			try {
				consumerData.consumer.close();
			} catch (error) {
				loggers.consumerManager.warn(
					'Error closing consumer %s: %s',
					consumerId,
					(error as Error).message,
				);
			}
		}
		this.consumers.clear();
	}
}
