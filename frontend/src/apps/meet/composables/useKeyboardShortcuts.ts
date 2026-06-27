import { useShortcut } from "frappe-ui";
import { pushToTalkEnabled } from "../data/mediaPreferences";
import type { MediaState } from "./useMediaState";

export function useKeyboardShortcuts(deps: {
	mediaControls: {
		toggleMicrophone: () => Promise<void>;
		toggleCamera: () => Promise<void>;
	};
	mediaState: MediaState;
}) {
	const { mediaControls, mediaState } = deps;

	let unmutedByPushToTalk = false;

	useShortcut([
		{
			key: "d",
			ctrl: true,
			description: "Toggle microphone",
			group: "Meeting controls",
			condition: isNotTyping,
			handler: () => mediaControls.toggleMicrophone(),
		},
		{
			key: "e",
			ctrl: true,
			description: "Toggle camera",
			group: "Meeting controls",
			condition: isNotTyping,
			handler: () => mediaControls.toggleCamera(),
		},
		{
			key: " ",
			description: "Push to talk",
			group: "Meeting controls",
			triggeredOn: "hold",
			condition: () => pushToTalkEnabled.value && isNotTyping(),
			onHold: () => {
				if (!mediaState.isMicOn) {
					unmutedByPushToTalk = true;
					mediaControls.toggleMicrophone();
				}
			},
			onRelease: () => {
				if (unmutedByPushToTalk) {
					unmutedByPushToTalk = false;
					if (mediaState.isMicOn) {
						mediaControls.toggleMicrophone();
					}
				}
			},
		},
	]);
}

function isNotTyping() {
	return !document.activeElement?.closest(
		'input, textarea, [contenteditable="true"], [contenteditable=""]',
	);
}
