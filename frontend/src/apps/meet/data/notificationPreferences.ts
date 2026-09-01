import { type Ref, ref } from "vue";
import { readBoolean, writeBoolean } from "@/utils/localStorage";

export const notificationChimesEnabled: Ref<boolean> = ref(
	readBoolean("notificationPref.chimesEnabled", true),
);

export function setNotificationChimesEnabled(val: boolean): void {
	notificationChimesEnabled.value = !!val;
	writeBoolean("notificationPref.chimesEnabled", notificationChimesEnabled.value);
}
