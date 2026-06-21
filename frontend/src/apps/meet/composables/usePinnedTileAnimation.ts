import { nextTick, onUnmounted, type Ref, ref, watch } from "vue";
import type { PinnedTile } from "./useGridLayout";

interface UsePinnedTileAnimationOptions {
	container: Ref<HTMLElement | null>;
	pinnedPanelsMap: Ref<Record<string, HTMLElement>>;
	pinnedTiles: Ref<PinnedTile[]>;
	visibleTileCount: Ref<number>;
}

type TileStyle = Record<string, string | number>;

export function usePinnedTileAnimation({
	container,
	pinnedPanelsMap,
	pinnedTiles,
	visibleTileCount,
}: UsePinnedTileAnimationOptions) {
	const isFlipAnimating = ref(false);
	const pinnedTileStyles = ref<Record<string, TileStyle>>({});

	let flipCleanupTimer: ReturnType<typeof setTimeout> | null = null;
	let activeAnimations: Animation[] = [];
	let resizeObserver: ResizeObserver | null = null;
	let pinnedStyleRaf: number | null = null;
	let deferredPinnedTileMeasurement = false;

	const afterLayout = () =>
		new Promise<void>((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});

	const measurePinnedTileStyle = () => {
		const panels = Object.values(pinnedPanelsMap.value);
		if (!panels.length || !container.value || !pinnedTiles.value.length) {
			pinnedTileStyles.value = {};
			return;
		}

		const containerRect = container.value.getBoundingClientRect();
		const newStyles: Record<string, TileStyle> = {};

		pinnedTiles.value.forEach((tile) => {
			const key = `${tile.type}-${tile.id}`;
			const panel = pinnedPanelsMap.value[key];
			if (!panel) return;

			const panelRect = panel.getBoundingClientRect();
			newStyles[key] = {
				position: "absolute",
				top: `${panelRect.top - containerRect.top}px`,
				left: `${panelRect.left - containerRect.left}px`,
				width: `${panelRect.width}px`,
				height: `${panelRect.height}px`,
			};
		});

		pinnedTileStyles.value = newStyles;
	};

	const queuePinnedTileMeasurement = () => {
		if (isFlipAnimating.value) {
			deferredPinnedTileMeasurement = true;
			return;
		}
		if (pinnedStyleRaf) cancelAnimationFrame(pinnedStyleRaf);
		pinnedStyleRaf = requestAnimationFrame(() => {
			pinnedStyleRaf = null;
			measurePinnedTileStyle();
		});
	};

	const flushPinnedTileMeasurement = () => {
		if (!deferredPinnedTileMeasurement) return;
		deferredPinnedTileMeasurement = false;
		queuePinnedTileMeasurement();
	};

	const captureAllTileRects = () => {
		const rects = new Map<string, DOMRect>();
		if (!container.value) return rects;

		for (const el of container.value.querySelectorAll("[data-tile-id]")) {
			const id = el.getAttribute("data-tile-id");
			if (!id || el.classList.contains("hidden-tile")) continue;
			rects.set(id, el.getBoundingClientRect());
		}

		return rects;
	};

	const cancelActiveAnimations = () => {
		for (const animation of activeAnimations) {
			try {
				animation.cancel();
			} catch (_) {}
		}
		activeAnimations = [];
	};

	const performFLIP = (oldRects: Map<string, DOMRect>) => {
		if (!container.value) return;

		cancelActiveAnimations();

		const DURATION = 550;
		const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

		for (const el of container.value.querySelectorAll("[data-tile-id]")) {
			const id = el.getAttribute("data-tile-id");
			if (!id || el.classList.contains("hidden-tile")) continue;

			const oldRect = oldRects.get(id);
			const newRect = el.getBoundingClientRect();

			if (!oldRect) {
				activeAnimations.push(
					el.animate(
						[
							{ opacity: 0, transform: "scale(0.9)" },
							{ opacity: 1, transform: "scale(1)" },
						],
						{
							duration: DURATION * 0.6,
							easing: EASING,
							delay: DURATION * 0.2,
						},
					),
				);
				continue;
			}

			const dx = oldRect.left - newRect.left;
			const dy = oldRect.top - newRect.top;
			const sx = oldRect.width / newRect.width;
			const sy = oldRect.height / newRect.height;

			if (
				Math.abs(dx) < 2 &&
				Math.abs(dy) < 2 &&
				Math.abs(sx - 1) < 0.02 &&
				Math.abs(sy - 1) < 0.02
			) {
				continue;
			}

			activeAnimations.push(
				el.animate(
					[
						{
							transformOrigin: "top left",
							transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
						},
						{
							transformOrigin: "top left",
							transform: "translate(0px, 0px) scale(1, 1)",
						},
					],
					{ duration: DURATION, easing: EASING },
				),
			);
		}

		if (activeAnimations.length > 0) {
			Promise.all(
				activeAnimations.map((animation) => animation.finished.catch(() => {})),
			).then(() => {
				activeAnimations = [];
				isFlipAnimating.value = false;
				flushPinnedTileMeasurement();
			});
		} else {
			isFlipAnimating.value = false;
			flushPinnedTileMeasurement();
		}
	};

	watch(
		[pinnedTiles, container],
		() => {
			if (resizeObserver) {
				resizeObserver.disconnect();
				resizeObserver = null;
			}

			queuePinnedTileMeasurement();

			const panels = Object.values(pinnedPanelsMap.value);

			if (panels.length || container.value) {
				resizeObserver = new ResizeObserver(() => {
					queuePinnedTileMeasurement();
				});

				panels.forEach((panel) => {
					if (panel) resizeObserver?.observe(panel);
				});

				if (container.value) {
					resizeObserver.observe(container.value);
				}
			}
		},
		{ immediate: true, deep: true, flush: "post" },
	);

	watch(visibleTileCount, () => {
		queuePinnedTileMeasurement();
	});

	watch(
		() => [...pinnedTiles.value],
		async (nextPinned, prevPinned) => {
			if (JSON.stringify(nextPinned) === JSON.stringify(prevPinned)) {
				return;
			}

			if (flipCleanupTimer) clearTimeout(flipCleanupTimer);
			cancelActiveAnimations();

			isFlipAnimating.value = true;
			const oldRects = captureAllTileRects();

			await nextTick();
			await afterLayout();
			measurePinnedTileStyle();
			await nextTick();
			await afterLayout();

			performFLIP(oldRects);

			flipCleanupTimer = setTimeout(() => {
				isFlipAnimating.value = false;
				flushPinnedTileMeasurement();
			}, 700);
		},
		{ flush: "pre" },
	);

	onUnmounted(() => {
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}
		if (pinnedStyleRaf) {
			cancelAnimationFrame(pinnedStyleRaf);
			pinnedStyleRaf = null;
		}
		if (flipCleanupTimer) {
			clearTimeout(flipCleanupTimer);
			flipCleanupTimer = null;
		}
		cancelActiveAnimations();
	});

	return {
		isFlipAnimating,
		pinnedTileStyles,
	};
}
