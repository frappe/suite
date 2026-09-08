/**
 * Consumer Manager
 * Handles MediaSoup consumer lifecycle and stream management
 */

import type { AppData, Consumer, MediaKind } from "mediasoup-client/types";

export interface ConsumerEntry {
	id: string;
	participantId: string;
	producerId: string;
	kind: MediaKind;
	isScreen: boolean;
	adaptivelyPaused: boolean;
	track?: MediaStreamTrack;
	appData?: AppData;
	createdAt: number;
	consumer: Consumer;
	close?: () => void;
	pause?: () => void;
	resume?: () => void;
}

interface ConsumerLostInfo {
	consumerId: string;
	participantId: string;
	producerId: string;
	kind: MediaKind;
	isScreen: boolean;
}

interface ConsumerEventHandlers {
	onConsumerAdded?: (entry: ConsumerEntry) => void;
	onConsumerRemoved?: (consumerId: string, consumer: ConsumerEntry) => void;
	onConsumerUpdated?: (
		consumerId: string,
		updatedConsumer: ConsumerEntry,
		updates: Partial<ConsumerEntry>,
	) => void;
	onAllConsumersCleared?: (consumerIds: string[]) => void;
	onConsumerLost?: (info: ConsumerLostInfo) => void;
}

export class ConsumerManager {
	consumers: Map<string, ConsumerEntry>;
	eventHandlers: ConsumerEventHandlers;
	private localCloseInProgress: Set<string> = new Set();

	constructor() {
		this.consumers = new Map();
		this.eventHandlers = {};
	}

	setEventHandlers(handlers: ConsumerEventHandlers): void {
		this.eventHandlers = { ...this.eventHandlers, ...handlers };
	}

	addConsumer(
		consumer: Consumer,
		participantIdOverride: string | null = null,
	): ConsumerEntry | false {
		if (!consumer?.id) {
			console.error("Invalid consumer provided");
			return false;
		}

		const entry: ConsumerEntry = {
			id: consumer.id,
			participantId:
				participantIdOverride || (consumer.appData?.userId as string) || "",
			producerId: consumer.producerId,
			kind: consumer.kind,
			isScreen: consumer.appData?.type === "screen" || false,
			adaptivelyPaused: false,
			track: consumer.track,
			appData: consumer.appData,
			createdAt: Date.now(),
			consumer,
			close: consumer.close.bind(consumer),
			pause: consumer.pause.bind(consumer),
			resume: consumer.resume.bind(consumer),
		};

		this.consumers.set(consumer.id as string, entry);

		const emitLost = () => {
			if (this.localCloseInProgress.has(consumer.id)) {
				return;
			}
			if (!this.consumers.has(consumer.id)) {
				return;
			}
			this.removeConsumer(consumer.id);
			if (this.eventHandlers.onConsumerLost) {
				this.eventHandlers.onConsumerLost({
					consumerId: consumer.id,
					participantId: entry.participantId,
					producerId: entry.producerId,
					kind: entry.kind,
					isScreen: entry.isScreen,
				});
			}
		};

		consumer.once("@close", emitLost);
		consumer.once("trackended", emitLost);

		if (this.eventHandlers.onConsumerAdded) {
			this.eventHandlers.onConsumerAdded(entry);
		}

		return entry;
	}

	removeConsumer(consumerId: string): ConsumerEntry | undefined {
		const consumer = this.consumers.get(consumerId);
		if (consumer) {
			this.localCloseInProgress.add(consumerId);
			if (typeof consumer.close === "function") {
				try {
					consumer.close();
				} catch (error) {
					console.warn(`Error closing consumer ${consumerId}:`, error);
				}
			}
			this.localCloseInProgress.delete(consumerId);

			this.consumers.delete(consumerId);

			if (this.eventHandlers.onConsumerRemoved) {
				this.eventHandlers.onConsumerRemoved(consumerId, consumer);
			}
		}
		return consumer;
	}

	getConsumer(consumerId: string): ConsumerEntry | undefined {
		return this.consumers.get(consumerId);
	}

	getAllConsumers(): ConsumerEntry[] {
		return Array.from(this.consumers.values());
	}

	getConsumersByParticipant(participantId: string): ConsumerEntry[] {
		return this.getAllConsumers().filter(
			(consumer) => consumer.participantId === participantId,
		);
	}

	getVideoConsumer(participantId: string): ConsumerEntry | undefined {
		return this.getAllConsumers().find(
			(consumer) =>
				consumer.participantId === participantId &&
				consumer.kind === "video" &&
				!consumer.isScreen,
		);
	}

	getAudioConsumer(participantId: string): ConsumerEntry | undefined {
		return this.getAllConsumers().find(
			(consumer) =>
				consumer.participantId === participantId && consumer.kind === "audio",
		);
	}

	getScreenShareConsumers(): ConsumerEntry[] {
		return this.getAllConsumers().filter((consumer) => consumer.isScreen);
	}

	updateConsumer(
		consumerId: string,
		updates: Partial<ConsumerEntry>,
	): ConsumerEntry | null {
		const consumer = this.consumers.get(consumerId);
		if (consumer) {
			const updatedConsumer = { ...consumer, ...updates };
			this.consumers.set(consumerId, updatedConsumer);

			if (this.eventHandlers.onConsumerUpdated) {
				this.eventHandlers.onConsumerUpdated(
					consumerId,
					updatedConsumer,
					updates,
				);
			}

			return updatedConsumer;
		}
		return null;
	}

	cleanupParticipantConsumers(participantId: string): ConsumerEntry[] {
		const consumers = this.getConsumersByParticipant(participantId);
		const removedConsumers: ConsumerEntry[] = [];

		for (const consumer of consumers) {
			const removed = this.removeConsumer(consumer.id);
			if (removed) {
				removedConsumers.push(removed);
			}
		}

		return removedConsumers;
	}

	clear(): void {
		const consumerIds = Array.from(this.consumers.keys());

		// Close all consumers
		for (const consumerId of consumerIds) {
			this.localCloseInProgress.add(consumerId);
		}
		for (const consumer of this.consumers.values()) {
			if (typeof consumer.close === "function") {
				try {
					consumer.close();
				} catch (error) {
					console.warn("Error closing consumer during cleanup:", error);
				}
			}
		}
		for (const consumerId of consumerIds) {
			this.localCloseInProgress.delete(consumerId);
		}

		this.consumers.clear();

		// Notify event handlers
		if (this.eventHandlers.onAllConsumersCleared) {
			this.eventHandlers.onAllConsumersCleared(consumerIds);
		}
	}
}
