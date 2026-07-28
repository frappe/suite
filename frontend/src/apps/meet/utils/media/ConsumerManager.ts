/**
 * Consumer Manager
 * Handles MediaSoup consumer lifecycle and stream management
 */

import type { Consumer } from "mediasoup-client/types";

export interface ConsumerEntry {
	id: string;
	participantId: string;
	producerId: string;
	kind: string;
	isScreen: boolean;
	track?: MediaStreamTrack;
	appData?: Record<string, unknown>;
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
	kind: string;
	isScreen: boolean;
}

interface ConsumerEventHandlers {
	onConsumerAdded?: (entry: ConsumerEntry) => void;
	onConsumerRemoved?: (consumerId: string, consumer: ConsumerEntry) => void;
	onConsumerUpdated?: (
		consumerId: string,
		updatedConsumer: ConsumerEntry,
		updates: Record<string, unknown>,
	) => void;
	onAllConsumersCleared?: (consumerIds: string[]) => void;
	onConsumerLost?: (info: ConsumerLostInfo) => void;
}

interface ConsumerStats {
	total: number;
	video: number;
	audio: number;
	screenShare: number;
	byParticipant: Record<
		string,
		{ video: number; audio: number; screen: number }
	>;
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

	getConsumersByKind(kind: string): ConsumerEntry[] {
		return this.getAllConsumers().filter((consumer) => consumer.kind === kind);
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

	async pauseConsumer(consumerId: string): Promise<boolean> {
		const consumer = this.getConsumer(consumerId);
		if (consumer && typeof consumer.pause === "function") {
			try {
				await consumer.pause();
				console.log(`Consumer paused: ${consumerId}`);
				return true;
			} catch (error) {
				console.error(`Failed to pause consumer ${consumerId}:`, error);
			}
		}
		return false;
	}

	async resumeConsumer(consumerId: string): Promise<boolean> {
		const consumer = this.getConsumer(consumerId);
		if (consumer && typeof consumer.resume === "function") {
			try {
				await consumer.resume();
				console.log(`Consumer resumed: ${consumerId}`);
				return true;
			} catch (error) {
				console.error(`Failed to resume consumer ${consumerId}:`, error);
			}
		}
		return false;
	}

	async pauseParticipantConsumers(
		participantId: string,
		kind: string | null = null,
	): Promise<boolean[]> {
		const consumers = this.getConsumersByParticipant(participantId);
		const filteredConsumers = kind
			? consumers.filter((c) => c.kind === kind)
			: consumers;

		const results = await Promise.all(
			filteredConsumers.map((consumer) => this.pauseConsumer(consumer.id)),
		);

		console.log(
			`Paused ${filteredConsumers.length} consumers for ${participantId}`,
		);
		return results;
	}

	async resumeParticipantConsumers(
		participantId: string,
		kind: string | null = null,
	): Promise<boolean[]> {
		const consumers = this.getConsumersByParticipant(participantId);
		const filteredConsumers = kind
			? consumers.filter((c) => c.kind === kind)
			: consumers;

		const results = await Promise.all(
			filteredConsumers.map((consumer) => this.resumeConsumer(consumer.id)),
		);

		console.log(
			`Resumed ${filteredConsumers.length} consumers for ${participantId}`,
		);
		return results;
	}

	updateConsumer(
		consumerId: string,
		updates: Record<string, unknown>,
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

	getConsumerStats(): ConsumerStats {
		const all = this.getAllConsumers();
		return {
			total: all.length,
			video: all.filter((c) => c.kind === "video").length,
			audio: all.filter((c) => c.kind === "audio").length,
			screenShare: all.filter((c) => c.isScreen).length,
			byParticipant: this.getConsumersByParticipantStats(),
		};
	}

	getConsumersByParticipantStats(): Record<
		string,
		{ video: number; audio: number; screen: number }
	> {
		const stats: Record<
			string,
			{ video: number; audio: number; screen: number }
		> = {};
		for (const consumer of this.getAllConsumers()) {
			if (!stats[consumer.participantId]) {
				stats[consumer.participantId] = { video: 0, audio: 0, screen: 0 };
			}
			if (consumer.isScreen) {
				stats[consumer.participantId].screen++;
			} else {
				stats[consumer.participantId][consumer.kind as "video" | "audio"]++;
			}
		}
		return stats;
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
