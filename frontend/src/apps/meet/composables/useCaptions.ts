import { toast } from "frappe-ui";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { isUnknownRecord } from "../types";
import { type SFUClient, SFURequestError } from "../utils/SFUClient";
import { useE2EEState } from "./useE2EEState";

interface CaptionLine {
	id: string;
	participantId: string;
	participantName: string;
	text: string;
	isFinal?: boolean;
}

interface CaptionSegment {
	participantId: string;
	participantName?: string;
	text: string;
	isFinal?: boolean;
}

/** Owns this participant's caption preference, recent lines, and SFU subscription. */
export function useCaptions(deps: { sfuClient: SFUClient }) {
	const { sfuClient } = deps;
	const { isContextReady: isE2EEContextReady } = useE2EEState();
	const isCaptionsEnabled = ref(false);
	const captionLines = ref<CaptionLine[]>([]);
	const isAvailable = ref(!sfuClient.isE2EERequired());
	let nextCaptionId = 0;
	let desiredEnabled = isCaptionsEnabled.value;
	let isToggling = false;
	let hasRequestedE2EECleanup = false;
	let captionRestoreGeneration = 0;

	const addCaptionLine = (segment: CaptionSegment) => {
		const text = segment.text?.trim() || "";
		const draftIndex = captionLines.value.findIndex(
			(line) => line.participantId === segment.participantId && !line.isFinal,
		);

		if (segment.isFinal && !text) {
			if (draftIndex >= 0) captionLines.value.splice(draftIndex, 1);
			return;
		}
		if (!text) return;

		const line: CaptionLine = {
			id: `caption-${nextCaptionId++}`,
			participantId: segment.participantId,
			participantName: segment.participantName || segment.participantId,
			text,
			isFinal: segment.isFinal,
		};

		if (draftIndex >= 0) {
			captionLines.value.splice(draftIndex, 1, line);
		} else {
			captionLines.value.push(line);
		}

		if (captionLines.value.length > 50) {
			captionLines.value = captionLines.value.slice(-50);
		}
	};

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
		addCaptionLine({
			participantId: segment.participantId,
			participantName: segment.participantName || segment.participantId,
			text: segment.text,
			isFinal: segment.isFinal,
		});
	};

	const reconcileCaptionState = async () => {
		if (isToggling) return;
		isToggling = true;
		while (desiredEnabled !== isCaptionsEnabled.value) {
			const requestedEnabled = desiredEnabled;
			try {
				await sfuClient.sendRequest("stt:toggle", {
					enabled: requestedEnabled,
				});
				if (!requestedEnabled || isAvailable.value) {
					isCaptionsEnabled.value = requestedEnabled;
				}
			} catch (error) {
				console.error("Failed to toggle captions:", error);
				if (error instanceof SFURequestError) {
					if (requestedEnabled && isAvailable.value) {
						isCaptionsEnabled.value = true;
					} else {
						desiredEnabled = isCaptionsEnabled.value;
					}
				} else if (requestedEnabled === desiredEnabled) {
					desiredEnabled = isCaptionsEnabled.value;
					toast.error(
						`Failed to ${requestedEnabled ? "enable" : "disable"} captions`,
					);
				}
			}
		}
		isToggling = false;
	};

	const toggleCaptions = () => {
		captionRestoreGeneration++;
		if (!sfuClient.isConnected() || !isAvailable.value)
			return Promise.resolve();
		if (!isToggling) desiredEnabled = isCaptionsEnabled.value;
		desiredEnabled = !desiredEnabled;
		return reconcileCaptionState();
	};

	const restoreCaptionSubscription = async (): Promise<boolean> => {
		const generation = ++captionRestoreGeneration;
		if (
			!isCaptionsEnabled.value ||
			!sfuClient.isConnected() ||
			sfuClient.isE2EERequired()
		) {
			if (generation === captionRestoreGeneration) {
				isCaptionsEnabled.value = false;
			}
			return false;
		}
		try {
			await sfuClient.sendRequest("stt:toggle", { enabled: true });
			return true;
		} catch (error) {
			console.error("Failed to restore captions after reconnect:", error);
			const restored = error instanceof SFURequestError;
			if (generation === captionRestoreGeneration && !restored) {
				isCaptionsEnabled.value = false;
			}
			return restored;
		}
	};

	const disableCaptionsForE2EE = () => {
		isAvailable.value = false;
		desiredEnabled = false;
		isCaptionsEnabled.value = false;
		captionLines.value = [];
		if (sfuClient.isConnected() && !hasRequestedE2EECleanup) {
			hasRequestedE2EECleanup = true;
			void sfuClient
				.sendRequest("stt:toggle", { enabled: false })
				.catch((error) =>
					console.error("Failed to clean up captions for E2EE:", error),
				);
		}
	};

	if (!isAvailable.value) disableCaptionsForE2EE();

	onMounted(() => {
		sfuClient.on("stt:segment", handleSttSegment);
		document.addEventListener("meet:e2ee-host-enabled", disableCaptionsForE2EE);
	});

	onUnmounted(() => {
		sfuClient.off("stt:segment");
		document.removeEventListener(
			"meet:e2ee-host-enabled",
			disableCaptionsForE2EE,
		);
	});

	watch(isE2EEContextReady, (ready) => {
		if (ready) disableCaptionsForE2EE();
	});

	const reset = () => {
		isCaptionsEnabled.value = false;
		captionLines.value = [];
		nextCaptionId = 0;
	};

	return {
		isCaptionsEnabled,
		captionLines,
		isAvailable,
		toggleCaptions,
		restoreCaptionSubscription,
		disableCaptionsForE2EE,
		reset,
	};
}
