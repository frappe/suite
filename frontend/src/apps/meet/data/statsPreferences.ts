import { type Ref, ref } from "vue";
import { readBoolean, writeBoolean } from "@/utils/localStorage";

const STORAGE_KEY = "meetPref.statsForNerds";

export const showStatsForNerds: Ref<boolean> = ref(readBoolean(STORAGE_KEY));

export function setShowStatsForNerds(value: boolean): void {
	showStatsForNerds.value = value;
	writeBoolean(STORAGE_KEY, value);
}
