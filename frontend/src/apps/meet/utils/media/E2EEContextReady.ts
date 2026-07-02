import { E2EEMeeting } from "./E2EEMeeting";
import { useE2EEState } from "../../composables/useE2EEState";

const E2EE_CONTEXT_READY_EVENT = "meet:e2ee-context-ready";

export function notifyE2EEContextReady(): void {
	void E2EEMeeting.instance
		.getSessionFingerprint()
		.then((fingerprint) => useE2EEState().setContextReady(fingerprint));
	if (typeof document === "undefined") return;
	document.dispatchEvent(new CustomEvent(E2EE_CONTEXT_READY_EVENT));
}

export function resetE2EEContextReady(): void {
	useE2EEState().reset();
}

export function waitForE2EEContextReady(timeoutMs = 15_000): Promise<void> {
	if (E2EEMeeting.instance.hasMeetingContext()) {
		return Promise.resolve();
	}
	if (typeof document === "undefined") {
		return Promise.reject(new Error("E2EE meeting context is not ready"));
	}

	return new Promise((resolve, reject) => {
		const cleanup = () => {
			if (timer) clearTimeout(timer);
			document.removeEventListener(E2EE_CONTEXT_READY_EVENT, onReady);
		};
		const onReady = () => {
			if (!E2EEMeeting.instance.hasMeetingContext()) return;
			cleanup();
			resolve();
		};
		const timer =
			timeoutMs > 0
				? setTimeout(() => {
						cleanup();
						reject(
							new Error(
								"Timed out waiting for the encrypted meeting context. Ask a current encrypted participant to stay online, then try again.",
							),
						);
					}, timeoutMs)
				: null;

		document.addEventListener(E2EE_CONTEXT_READY_EVENT, onReady);
	});
}
