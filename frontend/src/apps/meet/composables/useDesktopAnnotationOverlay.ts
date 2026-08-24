import { onBeforeUnmount, watch } from "vue";
import type { MediaState } from "./useMediaState";
import type { SFUClient } from "../utils/SFUClient";
import {
	buildDesktopOverlayLaunchUrl,
	openDesktopOverlay,
	supportsDesktopAnnotationOverlay,
} from "../utils/annotations/desktopOverlay";

export function useDesktopAnnotationOverlay(deps: {
	mediaState: MediaState;
	sfuClient: SFUClient;
}): void {
	let generation = 0;
	const stopWatching = watch(
		() => deps.mediaState.localScreenShareProducerId,
		(producerId) => {
			generation += 1;
			if (!producerId || !supportsDesktopAnnotationOverlay()) return;
			void launch(producerId, generation);
		},
	);

	async function launch(producerId: string, launchGeneration: number) {
		try {
			const grant = await deps.sfuClient.createAnnotationOverlayGrant(producerId);
			if (
				generation !== launchGeneration ||
				deps.mediaState.localScreenShareProducerId !== producerId
			) {
				return;
			}
			const track = deps.mediaState.screenShareStream?.getVideoTracks()[0];
			const settings = track?.getSettings();
			const endpoint = deps.sfuClient.getSFUEndpoint();
			openDesktopOverlay(
				buildDesktopOverlayLaunchUrl({
					...endpoint,
					grant: grant.grant,
					producerId,
					captureWidth: settings?.width,
					captureHeight: settings?.height,
					displaySurface: settings?.displaySurface,
				}),
			);
		} catch (error) {
			console.warn("Could not launch the desktop annotation overlay:", error);
		}
	}

	onBeforeUnmount(() => {
		generation += 1;
		stopWatching();
	});
}
