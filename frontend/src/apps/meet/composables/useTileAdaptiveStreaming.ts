import { debounce } from "frappe-ui";
import type { Ref } from "vue";
import { inject, onBeforeUnmount, watch } from "vue";

type SFUMeetingManagerLike = {
	getVideoConsumerId: (participantId: string) => string | null;
	updateConsumerStreamPreferences: (
		consumerId: string,
		preferences: { visible: boolean; width: number; height: number },
	) => Promise<unknown> | unknown;
	onRemoteConsumerReady: (listener: (event: Event) => void) => () => void;
};

interface TileMetrics {
	width: number;
	height: number;
	visible: boolean;
}

interface TileController {
	active: boolean;
	participantId: string;
	element: HTMLVideoElement;
	resizeObserver: ResizeObserver | null;
	intersectionObserver: IntersectionObserver | null;
	width: number;
	height: number;
	visible: boolean;
	forceNext: boolean;
	lastSent: TileMetrics | null;
	debouncedUpdate: (() => void) | null;
	initialPending: boolean;
	stopListeningForConsumer: (() => void) | null;
}

const VISIBILITY_THRESHOLD = 0.1;
const SIZE_DELTA_THRESHOLD = 50;
const DEBOUNCE_MS = 300;

function isElementInViewport(element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	if (!rect || (rect.width === 0 && rect.height === 0)) return false;
	return (
		rect.bottom > 0 &&
		rect.right > 0 &&
		rect.top < window.innerHeight &&
		rect.left < window.innerWidth
	);
}

export function useTileAdaptiveStreaming() {
	const injectedManager = inject<Ref<SFUMeetingManagerLike | null>>("sfuManager");
	const controllers = new Map<string, TileController>();

	function getManager(): SFUMeetingManagerLike | null {
		if (!injectedManager) return null;

		return injectedManager.value;
	}

	async function updateConsumerPreferences(controller: TileController) {
		if (!controller.active) return;
		const manager = getManager();
		if (!manager) return;

		const consumerId = manager.getVideoConsumerId(controller.participantId);
		if (!consumerId) return;

		const visible =
			controller.visible && controller.width > 0 && controller.height > 0;
		const width = visible ? Math.round(controller.width) : 0;
		const height = visible ? Math.round(controller.height) : 0;

		// Don't send initial update without valid dimensions
		// else we'll get a paused stream
		if (
			controller.initialPending &&
			(!visible || width === 0 || height === 0)
		) {
			return;
		}

		const last = controller.lastSent;
		const widthChanged =
			!last || Math.abs(last.width - width) >= SIZE_DELTA_THRESHOLD;
		const visibilityChanged = !last || last.visible !== visible;

		// Skip if no meaningful change
		if (!controller.forceNext) {
			if (!visibilityChanged && visible && !widthChanged) return;
			if (!visibilityChanged && !visible) return;
		}

		controller.forceNext = false;

		try {
			await manager.updateConsumerStreamPreferences(consumerId, {
				visible,
				width,
				height,
			});
			if (!controller.active || getManager() !== manager) return;
			controller.lastSent = { visible, width, height };
			if (controller.initialPending) {
				controller.initialPending = false;
			}
		} catch (error) {
			console.warn(
				"Failed to update consumer preferences for",
				controller.participantId,
				error,
			);
		}
	}

	function scheduleUpdate(controller: TileController, immediate = false) {
		if (!controller.active) return;
		if (immediate) {
			controller.forceNext = true;
			void updateConsumerPreferences(controller);
		} else if (controller.debouncedUpdate) {
			controller.debouncedUpdate();
		}
	}

	function cleanupController(controller: TileController) {
		controller.active = false;
		if (controller.resizeObserver) {
			controller.resizeObserver.disconnect();
		}
		if (controller.intersectionObserver) {
			controller.intersectionObserver.disconnect();
		}
		controller.stopListeningForConsumer?.();
		controller.stopListeningForConsumer = null;
	}

	function bindControllerToManager(controller: TileController) {
		controller.stopListeningForConsumer?.();
		controller.stopListeningForConsumer = null;
		const manager = getManager();
		if (!manager) return;
		controller.stopListeningForConsumer = manager.onRemoteConsumerReady(
			(event: Event) => {
				const customEvent = event as CustomEvent;
				if (customEvent.detail?.participantId === controller.participantId) {
					scheduleUpdate(controller, false);
				}
			},
		);
	}

	function createController(participantId: string, element: HTMLVideoElement) {
		const controller: TileController = {
			active: true,
			participantId,
			element,
			resizeObserver: null,
			intersectionObserver: null,
			// Initialize with 0x0 so ResizeObserver always detects a size change
			width: 0,
			height: 0,
			visible: false,
			forceNext: true,
			initialPending: true,
			lastSent: null,
			debouncedUpdate: null,
			stopListeningForConsumer: null,
		};

		controller.debouncedUpdate = debounce(() => {
			void updateConsumerPreferences(controller);
		}, DEBOUNCE_MS);

		bindControllerToManager(controller);

		// to check size of the tile
		controller.resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const newWidth = Math.max(entry.contentRect.width, 0);
			const newHeight = Math.max(entry.contentRect.height, 0);

			controller.width = newWidth;
			controller.height = newHeight;
			// Update visibility check when dimensions become valid
			if (newWidth > 0 && newHeight > 0) {
				controller.visible = isElementInViewport(element);
			}
			scheduleUpdate(controller, controller.initialPending);
		});
		controller.resizeObserver.observe(element);

		// to check visibility
		controller.intersectionObserver = new IntersectionObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const isVisible =
				entry.isIntersecting && entry.intersectionRatio >= VISIBILITY_THRESHOLD;
			if (controller.visible !== isVisible) {
				controller.visible = isVisible;
				scheduleUpdate(controller, controller.initialPending || isVisible);
			} else if (isVisible) {
				scheduleUpdate(controller, controller.initialPending);
			}
		});
		controller.intersectionObserver.observe(element);

		const onLoadedMetadata = () => {
			controller.width = Math.max(element.clientWidth || 0, 0);
			controller.height = Math.max(element.clientHeight || 0, 0);
			// Update visibility check when metadata loads
			if (controller.width > 0 && controller.height > 0) {
				controller.visible = isElementInViewport(element);
			}
			scheduleUpdate(controller, controller.initialPending);
		};

		if (element.readyState >= 1) {
			onLoadedMetadata();
		} else {
			element.addEventListener("loadedmetadata", onLoadedMetadata, {
				once: true,
			});
		}

		return controller;
	}

	function registerTile(
		participantId: string,
		element: HTMLVideoElement | null,
	) {
		const existing = controllers.get(participantId);

		if (!element) {
			if (existing) {
				cleanupController(existing);
				controllers.delete(participantId);
			}
			return;
		}

		if (existing?.element === element) {
			return;
		}

		if (existing) {
			cleanupController(existing);
			controllers.delete(participantId);
		}

		const controller = createController(participantId, element);
		controllers.set(participantId, controller);
	}

	const stopWatchingManager = injectedManager
		? watch(injectedManager, () => {
				for (const controller of controllers.values()) {
					bindControllerToManager(controller);
					controller.lastSent = null;
					scheduleUpdate(controller, true);
				}
			})
		: () => {};

	onBeforeUnmount(() => {
		stopWatchingManager();
		for (const controller of controllers.values()) {
			cleanupController(controller);
		}
		controllers.clear();
	});

	return {
		registerTile,
	};
}
