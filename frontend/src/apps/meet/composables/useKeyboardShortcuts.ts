import { useShortcut } from "frappe-ui";
import { reactive } from "vue";
import { pushToTalkEnabled } from "../data/mediaPreferences";

export const meetingControls = reactive({
	toggleMicrophone: async () => {},
	toggleCamera: async () => {},
	isMicOn: false,
});

export function useKeyboardShortcuts(isActive?: () => boolean) {
	const isActiveFn = isActive || (() => true);

	let unmutedByPushToTalk = false;

	useShortcut([
		{
			key: "d",
			ctrl: true,
			description: "Toggle microphone",
			group: "Meeting controls",
			condition: isNotTyping,
			handler: () => {
				if (isActiveFn()) meetingControls.toggleMicrophone();
			},
		},
		{
			key: "e",
			ctrl: true,
			description: "Toggle camera",
			group: "Meeting controls",
			condition: isNotTyping,
			handler: () => {
				if (isActiveFn()) meetingControls.toggleCamera();
			},
		},
		{
			key: " ",
			description: "Push to talk",
			group: "Meeting controls",
			triggeredOn: "hold",
			condition: isNotTyping,
			onHold: () => {
				if (isActiveFn() && pushToTalkEnabled.value && !meetingControls.isMicOn) {
					unmutedByPushToTalk = true;
					meetingControls.toggleMicrophone();
				}
			},
			onRelease: () => {
				if (unmutedByPushToTalk) {
					unmutedByPushToTalk = false;
					if (meetingControls.isMicOn) {
						meetingControls.toggleMicrophone();
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
