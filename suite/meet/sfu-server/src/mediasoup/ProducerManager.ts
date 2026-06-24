import { EventEmitter } from 'node:events';
import type * as mediasoup from 'mediasoup';
import type {
	AppData,
	CloseProducerResult,
	ProducerData,
	RtpParameters,
	WebRtcTransport,
} from '../types';
import { loggers } from '../utils/logger';

export class ProducerManager extends EventEmitter {
	private producers = new Map<string, ProducerData>();

	async createProducer(
		transport: WebRtcTransport,
		roomId: string,
		peerId: string,
		rtpParameters: RtpParameters,
		kind: 'audio' | 'video',
		appData: AppData = {},
	): Promise<{ id: string; kind: 'audio' | 'video'; appData: AppData }> {
		loggers.producerManager.info(
			'Creating %s producer for peer %s',
			kind,
			peerId,
		);

		const producer = await transport.produce({
			kind,
			rtpParameters,
			appData,
		});

		const producerData: ProducerData = {
			roomId,
			peerId,
			producer,
		};
		this.producers.set(producer.id, producerData);

		loggers.producerManager.info(
			'Producer %s (%s) created for peer %s',
			producer.id,
			kind,
			peerId,
		);

		producer.on('score', (scores) => {
			this.emit('score', roomId, peerId, kind, scores);
		});

		return {
			id: producer.id,
			kind: producer.kind,
			appData: producer.appData || appData,
		};
	}

	closeProducer(producerId: string): CloseProducerResult {
		const producerData = this.producers.get(producerId);
		if (!producerData) return { isScreen: false, removedConsumers: [] };

		const { producer } = producerData;
		const isScreen = producer?.appData?.type === 'screen';

		try {
			producer.close();
		} catch (error) {
			loggers.producerManager.warn(
				'Error closing producer %s: %s',
				producerId,
				(error as Error).message,
			);
		}

		this.producers.delete(producerId);

		loggers.producerManager.info(
			'Producer closed: %s%s',
			producerId,
			isScreen ? ' (screen)' : '',
		);

		this.emit(
			'producer_closed',
			producerData.roomId,
			producerData.peerId,
			producer.kind,
			producerId,
		);

		return { isScreen, removedConsumers: [] };
	}

	async pauseProducer(producerId: string): Promise<boolean> {
		const producerData = this.producers.get(producerId);
		if (!producerData) {
			return false;
		}

		const { producer } = producerData;
		if (producer.paused) {
			return false;
		}

		try {
			await producer.pause();
			loggers.producerManager.info('Producer paused: %s', producerId);
			return true;
		} catch (error) {
			loggers.producerManager.warn(
				'Failed to pause producer %s: %s',
				producerId,
				(error as Error).message,
			);
			return false;
		}
	}

	async resumeProducer(producerId: string): Promise<boolean> {
		const producerData = this.producers.get(producerId);
		if (!producerData) {
			return false;
		}

		const { producer } = producerData;
		if (!producer.paused) {
			return false;
		}

		try {
			await producer.resume();
			loggers.producerManager.info('Producer resumed: %s', producerId);
			return true;
		} catch (error) {
			loggers.producerManager.warn(
				'Failed to resume producer %s: %s',
				producerId,
				(error as Error).message,
			);
			return false;
		}
	}

	getProducer(producerId: string): mediasoup.types.Producer | undefined {
		return this.producers.get(producerId)?.producer;
	}

	getProducerData(producerId: string): ProducerData | undefined {
		return this.producers.get(producerId);
	}

	getProducerCount(): number {
		return this.producers.size;
	}

	cleanup(): void {
		for (const [producerId, producerData] of this.producers) {
			try {
				producerData.producer.close();
			} catch (error) {
				loggers.producerManager.warn(
					'Error closing producer %s: %s',
					producerId,
					(error as Error).message,
				);
			}
		}
		this.producers.clear();
	}
}
