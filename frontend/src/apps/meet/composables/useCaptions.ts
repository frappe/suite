import { onMounted, onUnmounted, watch } from "vue";
import { isUnknownRecord } from "../types";
import { type SFUClient, SFURequestError } from "../utils/SFUClient";
import { useCaptionStore } from "./useCaptionStore";
import { useE2EEState } from "./useE2EEState";

export async function restoreCaptionSubscription(
	sfuClient: SFUClient,
	isCaptionsEnabled: boolean,
): Promise<boolean> {
	if (
		!isCaptionsEnabled ||
		!sfuClient.isConnected() ||
		sfuClient.isE2EERequired()
	)
		return false;
	try {
		await sfuClient.sendRequest("stt:toggle", { enabled: true });
		return true;
	} catch (error) {
		console.error("Failed to restore captions after reconnect:", error);
		return error instanceof SFURequestError;
	}
}

/** Connects the local caption store to this participant's SFU subscription. */
export function useCaptions(deps: { sfuClient: SFUClient }) {
	const { sfuClient } = deps;
	const captionStore = useCaptionStore();
	const { isContextReady: isE2EEContextReady } = useE2EEState();
	let captionOperationGeneration = 0;

	const handleSttSegment = (data: unknown) => {
		if (!isUnknownRecord(data) || !isUnknownRecord(data.segment)) return;
		const segment = data.segment;
		if (
			typeof segment.participantId !== "string" ||
			typeof segment.text !== "string" ||
			typeof segment.timestamp !== "string" ||
			(segment.participantName !== undefined &&
				typeof segment.participantName !== "string") ||
			(segment.isFinal !== undefined && typeof segment.isFinal !== "boolean")
		)
			return;
		captionStore.addCaptionLine({
			participantId: segment.participantId,
			participantName: segment.participantName || segment.participantId,
			text: segment.text,
			timestamp: segment.timestamp,
			isFinal: segment.isFinal,
		});
	};

	const toggleCaptions = async () => {
		if (!sfuClient.isConnected()) return;

		const newEnabled = !captionStore.isCaptionsEnabled;
		if (newEnabled && sfuClient.isE2EERequired()) return;
		const generation = ++captionOperationGeneration;
		try {
			await sfuClient.sendRequest("stt:toggle", {
				enabled: newEnabled,
			});
			if (generation !== captionOperationGeneration) return;
			captionStore.setCaptionsEnabled(newEnabled);
		} catch (error) {
			console.error("Failed to toggle captions:", error);
			if (
				generation === captionOperationGeneration &&
				error instanceof SFURequestError
			) {
				captionStore.setCaptionsEnabled(newEnabled);
			}
		}
	};

	const disableCaptionsForE2EE = () => {
		captionOperationGeneration++;
		captionStore.setCaptionsEnabled(false);
		captionStore.clearCaptionLines();
		if (sfuClient.isConnected()) {
			void sfuClient.sendRequest("stt:toggle", { enabled: false });
		}
	};

	onMounted(() => {
		sfuClient.on("stt:segment", handleSttSegment);
	});

	onUnmounted(() => {
		sfuClient.off("stt:segment");
	});

	watch(isE2EEContextReady, (ready) => {
		if (ready) disableCaptionsForE2EE();
	});

	return {
		toggleCaptions,
		disableCaptionsForE2EE,
	};
}
