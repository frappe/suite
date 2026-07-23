import { type Ref, ref } from "vue";

const STORAGE_KEY = "meetPref.statsForNerds";

export const showStatsForNerds: Ref<boolean> = ref(
	localStorage.getItem(STORAGE_KEY) === "1",
);

export function setShowStatsForNerds(value: boolean): void {
	showStatsForNerds.value = value;
	localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
}
