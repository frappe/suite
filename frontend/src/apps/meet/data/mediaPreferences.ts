import { type Ref, ref } from "vue";
import {
	readBoolean,
	readString,
	writeBoolean,
	writeString,
} from "@/utils/localStorage";

export const micEnabled: Ref<boolean> = ref(readBoolean("mediaPref.mic", false));
export const cameraEnabled: Ref<boolean> = ref(
	readBoolean("mediaPref.camera", false),
);
export const selectedCameraId: Ref<string> = ref(
	readString("mediaPref.cameraId", ""),
);
export const selectedMicId: Ref<string> = ref(
	readString("mediaPref.micId", ""),
);
export const selectedSpeakerId: Ref<string> = ref(
	readString("mediaPref.speakerId", ""),
);
export const noiseCancellationEnabled: Ref<boolean> = ref(
	readBoolean("mediaPref.noiseCancellation", false),
);

export const pushToTalkEnabled: Ref<boolean> = ref(
	readBoolean("mediaPref.pushToTalk", false),
);

export const autoHideToolbar: Ref<boolean> = ref(
	readBoolean("mediaPref.autoHideToolbar", false),
);

export function setNoiseCancellationEnabled(val: boolean): void {
	noiseCancellationEnabled.value = !!val;
	writeBoolean("mediaPref.noiseCancellation", noiseCancellationEnabled.value);
}

export function setPushToTalkEnabled(val: boolean): void {
	pushToTalkEnabled.value = !!val;
	writeBoolean("mediaPref.pushToTalk", pushToTalkEnabled.value);
}

export function setAutoHideToolbar(val: boolean): void {
	autoHideToolbar.value = !!val;
	writeBoolean("mediaPref.autoHideToolbar", autoHideToolbar.value);
}

export function setMicEnabled(val: boolean): void {
	micEnabled.value = !!val;
	writeBoolean("mediaPref.mic", micEnabled.value);
}

export function setCameraEnabled(val: boolean): void {
	cameraEnabled.value = !!val;
	writeBoolean("mediaPref.camera", cameraEnabled.value);
}

export function setSelectedCameraId(deviceId: string): void {
	selectedCameraId.value = deviceId || "";
	writeString("mediaPref.cameraId", selectedCameraId.value);
}

export function setSelectedMicId(deviceId: string): void {
	selectedMicId.value = deviceId || "";
	writeString("mediaPref.micId", selectedMicId.value);
}

export function setSelectedSpeakerId(deviceId: string): void {
	selectedSpeakerId.value = deviceId || "";
	writeString("mediaPref.speakerId", selectedSpeakerId.value);
}

export function loadMediaPreferences(): void {
	micEnabled.value = readBoolean("mediaPref.mic", true);
	cameraEnabled.value = readBoolean("mediaPref.camera", true);
	selectedCameraId.value = readString("mediaPref.cameraId", "");
	selectedSpeakerId.value = readString("mediaPref.speakerId", "");
	selectedMicId.value = readString("mediaPref.micId", "");
	noiseCancellationEnabled.value = readBoolean(
		"mediaPref.noiseCancellation",
		false,
	);
	pushToTalkEnabled.value = readBoolean("mediaPref.pushToTalk", false);
	autoHideToolbar.value = readBoolean("mediaPref.autoHideToolbar", false);
}
