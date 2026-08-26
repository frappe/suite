import { defineStore } from "pinia";
import { ref } from "vue";

interface CaptionLine {
	id: string;
	participantId: string;
	participantName: string;
	text: string;
	timestamp: string;
	isFinal?: boolean;
}

interface CaptionSegment {
	participantId: string;
	participantName?: string;
	text: string;
	timestamp: string;
	isFinal?: boolean;
}

/** Stores this participant's current caption preference and recent lines. */
export const useCaptionStore = defineStore("caption", () => {
	const maxLines = 50;
	const isCaptionsEnabled = ref(false);
	const captionLines = ref<CaptionLine[]>([]);
	let nextCaptionId = 0;

	function addCaptionLine(segment: CaptionSegment) {
		const text = segment.text?.trim() || "";
		const draftIndex = captionLines.value.findIndex(
			(line) => line.participantId === segment.participantId && !line.isFinal,
		);

		if (segment.isFinal && !text) {
			if (draftIndex >= 0) {
				captionLines.value.splice(draftIndex, 1);
			}
			return;
		}
		if (!text) return;

		const line: CaptionLine = {
			id: `caption-${nextCaptionId++}`,
			participantId: segment.participantId,
			participantName: segment.participantName || segment.participantId,
			text,
			timestamp: segment.timestamp,
			isFinal: segment.isFinal,
		};

		if (draftIndex >= 0) {
			captionLines.value.splice(draftIndex, 1, line);
		} else if (!segment.isFinal) {
			captionLines.value.push(line);
		} else {
			captionLines.value.push(line);
		}

		if (captionLines.value.length > maxLines) {
			captionLines.value = captionLines.value.slice(-maxLines);
		}
	}

	function clearCaptionLines() {
		captionLines.value = [];
	}

	function setCaptionsEnabled(enabled: boolean) {
		isCaptionsEnabled.value = enabled;
	}

	function $reset() {
		isCaptionsEnabled.value = false;
		captionLines.value = [];
		nextCaptionId = 0;
	}

	return {
		isCaptionsEnabled,
		captionLines,
		addCaptionLine,
		clearCaptionLines,
		setCaptionsEnabled,
		$reset,
	};
});
