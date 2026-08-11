import { defineStore } from "pinia";
import { ref } from "vue";

export interface ConnectionState {
	connectionError: string | null;
	isInPreview: boolean;
	codecStrategy: string;
	networkQuality: string;
	connectionIssues: string[];
	guestId: string | null;
	guestAuthToken: string | null;
	guestSfuUrl: string | null;
	guestSfuPort: string | null;
	guestSessionToken: string | null;
	justCreated: boolean;
	$reset: () => void;
}

export const useConnectionState = defineStore("meet-connection", () => {
	const connectionError = ref<string | null>(null);
	const isInPreview = ref(true);
	const codecStrategy = ref("svc");
	const networkQuality = ref("good");
	const connectionIssues = ref<string[]>([]);
	const guestId = ref<string | null>(null);
	const guestAuthToken = ref<string | null>(null);
	const guestSfuUrl = ref<string | null>(null);
	const guestSfuPort = ref<string | null>(null);
	const guestSessionToken = ref<string | null>(null);
	const justCreated = ref(false);

	function $reset() {
		connectionError.value = null;
		isInPreview.value = true;
		codecStrategy.value = "svc";
		networkQuality.value = "good";
		connectionIssues.value = [];
		guestId.value = null;
		guestAuthToken.value = null;
		guestSfuUrl.value = null;
		guestSfuPort.value = null;
		guestSessionToken.value = null;
		justCreated.value = false;
	}

	return {
		connectionError,
		isInPreview,
		codecStrategy,
		networkQuality,
		connectionIssues,
		guestId,
		guestAuthToken,
		guestSfuUrl,
		guestSfuPort,
		guestSessionToken,
		justCreated,
		$reset,
	};
});
