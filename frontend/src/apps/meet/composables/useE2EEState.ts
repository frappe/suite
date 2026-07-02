import { computed, ref } from "vue";

const isContextReady = ref(false);
const sessionFingerprint = ref<string | null>(null);

export function useE2EEState() {
	return {
		isContextReady: computed(() => isContextReady.value),
		sessionFingerprint: computed(() => sessionFingerprint.value),
		setContextReady(fingerprint: string | null) {
			isContextReady.value = true;
			sessionFingerprint.value = fingerprint;
		},
		reset() {
			isContextReady.value = false;
			sessionFingerprint.value = null;
		},
	};
}
