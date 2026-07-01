import { onUnmounted, type Ref, ref, watch, watchPostEffect } from "vue";
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
	const pinnedTileStyles = ref<Record<string, TileStyle>>({});

	let resizeObserver: ResizeObserver | null = null;
	let pinnedStyleRaf: number | null = null;

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
		if (pinnedStyleRaf) cancelAnimationFrame(pinnedStyleRaf);
		pinnedStyleRaf = requestAnimationFrame(() => {
			pinnedStyleRaf = null;
			measurePinnedTileStyle();
		});
	};

	watchPostEffect(() => {
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}

		const panels = Object.values(pinnedPanelsMap.value);
		if (panels.length || container.value) {
			resizeObserver = new ResizeObserver(queuePinnedTileMeasurement);
			for (const panel of panels) resizeObserver.observe(panel);
			if (container.value) resizeObserver.observe(container.value);
		}

		queuePinnedTileMeasurement();
	});

	watch(visibleTileCount, () => {
		queuePinnedTileMeasurement();
	});
	watch(pinnedTiles, queuePinnedTileMeasurement, { deep: true, flush: "post" });

	onUnmounted(() => {
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}
		if (pinnedStyleRaf) {
			cancelAnimationFrame(pinnedStyleRaf);
			pinnedStyleRaf = null;
		}
	});

	return {
		pinnedTileStyles,
	};
}
