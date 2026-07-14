// E2EE connection handshake — Vue composable wrapper.
//
// The state machine lives in E2EEHandshakeController; this composable
// wires Vue reactivity, DOM events, and Frappe Realtime events around it.
//
// The only consumer is useSFUConnection.ts.  Internal state refs that
// no caller reads are removed from the return type.

import { onUnmounted, type Ref } from "vue";
import { E2EEEpochSignalingController } from "../utils/media/E2EEEpochSignalingController";
import { E2EEHandshakeController } from "../utils/media/E2EEHandshakeController";
import type { SFUClient } from "../utils/SFUClient";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import type { CurrentUser } from "./useCurrentUser";
import { useDeviceIdentity } from "./useDeviceIdentity";
import type { MediaState } from "./useMediaState";

interface E2EEConnectionHandshakeDeps {
	meetingId: string;
	sfuClient: SFUClient;
	sfuManager: Ref<SFUMeetingManager | null>;
	currentUser: CurrentUser;
	mediaState: MediaState;
	isCurrentTabHost: Ref<boolean>;
}

export interface E2EEConnectionHandshake {
	handleMeetingE2EEEnabled: (data: {
		meeting_id?: string;
		e2ee_enabled?: boolean;
	}) => Promise<void>;
	setupRealtimeEventListeners: () => void;
	teardownRealtimeEventListeners: () => void;
	teardownForDisconnect: () => void;
}

export function useE2EEConnectionHandshake(
	deps: E2EEConnectionHandshakeDeps,
): E2EEConnectionHandshake {
	const { meetingId, sfuClient, sfuManager, currentUser, mediaState } = deps;

	const { getIdentity: getDeviceIdentity } = useDeviceIdentity();

	const epochSignalingController = new E2EEEpochSignalingController({
		meetingId,
		sfuClient,
		currentUser,
		isCurrentTabHost: deps.isCurrentTabHost,
		getDeviceIdentity,
		onWelcomeProcessed: () => {
			void controller.handleMeetingE2EEEnabled({
				meeting_id: meetingId,
				e2ee_enabled: true,
			});
		},
	});
	const controller = new E2EEHandshakeController({
		meetingId,
		sfuClient,
		sfuManager,
		currentUser,
		mediaState,
		isCurrentTabHost: deps.isCurrentTabHost,
		getDeviceIdentity,
		epochSignalingController,
	});

	controller.onHandshakeComplete = (detail) => {
		controller.setMeetingContext(
			detail.meetingSecret,
			detail.keyVersion,
			detail.signingPrivateKey,
		);
	};

	// ── pagehide ──────────────────────────────────────────────────────
	let pagehideHandlerAttached = false;
	const teardownForDisconnect = () => {
		epochSignalingController.clearPendingKeyPackages();
		controller.teardownForDisconnect();
	};
	const onPageHide = () => teardownForDisconnect();

	// ── event routing ─────────────────────────────────────────────────
	let realtimeListenersAttached = false;

	const handleEpochMessageBound = (data: unknown) => {
		void epochSignalingController.handleEpochEnvelope(data);
	};
	const handleSFUReconnectBound = () => controller.handleTransientReconnect();
	const handleHostE2EEKeySetBound = (event: Event) => {
		const detail = (event as CustomEvent).detail;
		if (detail?.keyVersion) {
			void controller.handleHostE2EEKeySet(detail);
		}
	};
	const handleE2EEResyncBound = () => controller.handleTransientReconnect();

	function setupRealtimeEventListeners(): void {
		if (realtimeListenersAttached) return;
		sfuClient.on("e2ee:epoch", handleEpochMessageBound);
		sfuClient.on("reconnect", handleSFUReconnectBound);
		document.addEventListener(
			"meet:e2ee-host-enabled",
			handleHostE2EEKeySetBound,
		);
		document.addEventListener(
			"meet:e2ee-needs-key-resync",
			handleE2EEResyncBound,
		);
		realtimeListenersAttached = true;
	}

	function teardownRealtimeEventListeners(): void {
		if (!realtimeListenersAttached) return;
		sfuClient.off("e2ee:epoch", handleEpochMessageBound);
		sfuClient.off("reconnect", handleSFUReconnectBound);
		document.removeEventListener(
			"meet:e2ee-host-enabled",
			handleHostE2EEKeySetBound,
		);
		document.removeEventListener(
			"meet:e2ee-needs-key-resync",
			handleE2EEResyncBound,
		);
		realtimeListenersAttached = false;
	}

	if (typeof window !== "undefined") {
		window.addEventListener("pagehide", onPageHide);
		pagehideHandlerAttached = true;
	}

	onUnmounted(() => {
		teardownRealtimeEventListeners();
		if (pagehideHandlerAttached && typeof window !== "undefined") {
			window.removeEventListener("pagehide", onPageHide);
		}
	});

	const boundHandleMeetingE2EEEnabled =
		controller.handleMeetingE2EEEnabled.bind(controller);
	const boundTeardownForDisconnect = teardownForDisconnect;

	return {
		handleMeetingE2EEEnabled: boundHandleMeetingE2EEEnabled,
		setupRealtimeEventListeners,
		teardownRealtimeEventListeners,
		teardownForDisconnect: boundTeardownForDisconnect,
	};
}
