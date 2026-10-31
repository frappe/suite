import type { Consumer, Producer } from 'mediasoup/types';
import type { CameraLayerDemand as Demand } from '../../../types/cameraLayers';

interface Publication {
	producer: Producer;
	roomId: string;
	peerId: string;
	maximum: number;
	demand: Demand;
	consumers: Map<string, Consumer>;
	timer?: ReturnType<typeof setTimeout>;
}

/** All receiver demand, including recorder demand, controls one publisher cap. */
export class CameraLayerDemand {
	private publications = new Map<string, Publication>();

	constructor(
		private readonly notify: (
			roomId: string,
			peerId: string,
			demand: Demand,
		) => void,
	) {}

	addProducer(producer: Producer, roomId: string, peerId: string): void {
		const count = producer.rtpParameters?.encodings?.length ?? 0;
		if (
			producer.closed ||
			producer.kind !== 'video' ||
			producer.type !== 'simulcast' ||
			producer.appData?.type === 'screen' ||
			producer.appData?.cameraLayerDemand !== true ||
			count < 2
		)
			return;
		const publication: Publication = {
			producer,
			roomId,
			peerId,
			maximum: count - 1,
			consumers: new Map(),
			demand: {
				producerId: producer.id,
				version: 1,
				maxSpatialLayer: count - 1,
			},
		};
		this.publications.set(producer.id, publication);
		producer.observer.on('close', () => {
			clearTimeout(publication.timer);
			this.publications.delete(producer.id);
		});
		this.reconcile(publication);
	}

	addConsumer(consumer: Consumer): void {
		const publication = this.publications.get(consumer.producerId);
		if (!publication || consumer.closed) return;
		publication.consumers.set(consumer.id, consumer);
		consumer.observer.on('close', () => {
			publication.consumers.delete(consumer.id);
			this.reconcile(publication);
		});
		consumer.observer.on('pause', () => this.reconcile(publication));
		consumer.observer.on('resume', () => this.reconcile(publication));
		this.reconcile(publication);
	}

	preferencesChanged(consumer: Consumer): void {
		const publication = this.publications.get(consumer.producerId);
		if (publication) this.reconcile(publication);
	}

	get(producerId: string): Demand | null {
		const publication = this.publications.get(producerId);
		return publication ? { ...publication.demand } : null;
	}

	cleanup(): void {
		for (const publication of this.publications.values())
			clearTimeout(publication.timer);
		this.publications.clear();
	}

	private target(publication: Publication): number {
		let target = 0; // Never stop the tiny stream.
		for (const consumer of publication.consumers.values()) {
			if (consumer.closed || consumer.paused) continue;
			// Actual received layers can be low because we capped the publisher.
			// Unknown preferences must bootstrap at full quality, including recorders.
			target = Math.max(
				target,
				consumer.preferredLayers?.spatialLayer ?? publication.maximum,
			);
		}
		return Math.min(target, publication.maximum);
	}

	private reconcile(publication: Publication): void {
		if (this.publications.get(publication.producer.id) !== publication) return;
		const target = this.target(publication);
		if (target >= publication.demand.maxSpatialLayer) {
			clearTimeout(publication.timer);
			publication.timer = undefined;
			this.commit(publication, target);
		} else if (!publication.timer) {
			publication.timer = setTimeout(() => {
				publication.timer = undefined;
				if (this.publications.get(publication.producer.id) === publication)
					this.commit(publication, this.target(publication));
			}, 3_000);
		}
	}

	private commit(publication: Publication, layer: number): void {
		if (layer === publication.demand.maxSpatialLayer) return;
		publication.demand = {
			producerId: publication.producer.id,
			version: publication.demand.version + 1,
			maxSpatialLayer: layer,
		};
		this.notify(publication.roomId, publication.peerId, {
			...publication.demand,
		});
	}
}
