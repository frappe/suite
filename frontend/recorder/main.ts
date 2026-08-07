import { createPinia } from "pinia";
import { computed, createApp, h, ref } from "vue";
import "../src/index.css";
import { useChatStore } from "../src/apps/meet/composables/useChatStore";
import { useGridLayout } from "../src/apps/meet/composables/useGridLayout";
import { useLobbyStore } from "../src/apps/meet/composables/useLobbyStore";
import { useMediaState } from "../src/apps/meet/composables/useMediaState";
import { useParticipantStore } from "../src/apps/meet/composables/useParticipantStore";
import { useRaiseHandStore } from "../src/apps/meet/composables/useRaiseHandStore";
import { useReactionStore } from "../src/apps/meet/composables/useReactionStore";
import RecorderRenderer from "./RecorderRenderer.vue";
import { RecorderRendererBridge } from "./rendererBridge";
import { RecorderSocketController } from "./RecorderSocketController";

const bridge = new RecorderRendererBridge();
await bridge.initialize();
const config = await bridge.waitForConfig();
const pinia = createPinia();

const app = createApp({
	setup() {
		const participantStore = useParticipantStore();
		const mediaState = useMediaState();
		const chatStore = useChatStore();
		const reactionStore = useReactionStore();
		const raiseHandStore = useRaiseHandStore();
		const lobbyStore = useLobbyStore();
		const gridLayout = useGridLayout(mediaState);
		const messages = ref<Array<{ id: string; author: string; text: string; avatar?: string | null }>>([]);
		const pendingScreenAttachments = new Map<string, { resolve: () => void; reject: (error: unknown) => void }>();
		const controller = new RecorderSocketController(bridge, undefined, {
			participantAdded: (participant) => participantStore.addParticipant(participant),
			participantRemoved: (id) => participantStore.removeParticipant(id),
			participantUpdated: (id, updates) => participantStore.updateParticipant(id, updates),
			activeSpeakersChanged: (ids) => { participantStore.activeSpeakerIds = ids; participantStore.stableSpeakerIds = ids; },
			screenStarted: ({ participantId, consumerId, stream, startedAt }) => {
				mediaState.screenShareStreams[consumerId] = stream;
				mediaState.activeScreenShareConsumers = [...mediaState.activeScreenShareConsumers.filter((s) => s.consumerId !== consumerId), { participantId, consumerId, startedAt }];
				return new Promise<void>((resolve, reject) => pendingScreenAttachments.set(consumerId, { resolve, reject }));
			},
			screenStopped: (participantId) => {
				const removed = mediaState.activeScreenShareConsumers.filter((s) => s.participantId === participantId);
				mediaState.activeScreenShareConsumers = mediaState.activeScreenShareConsumers.filter((s) => s.participantId !== participantId);
				for (const share of removed) delete mediaState.screenShareStreams[share.consumerId];
			},
			reactionReceived: (id, reaction) => reactionStore.showReactionForUser(id, reaction),
			handChanged: (id, raised, timestamp) => raised ? raiseHandStore.raiseHand(id, timestamp) : raiseHandStore.lowerHand(id),
			handsSynced: (hands) => raiseHandStore.setHands(hands),
			chatReceived: (message) => {
				if (config.publicChat === false) return;
				const participant = message.participantId
					? participantStore.participants[message.participantId] as { avatar?: string | null } | undefined
					: undefined;
				messages.value = [...messages.value, { ...message, avatar: participant?.avatar }].slice(-5);
				window.setTimeout(() => messages.value = messages.value.filter((item) => item.id !== message.id), 8000);
			},
			roomEmpty: () => bridge.reportRoomEmpty(),
		});
		void controller.connect(config).catch(() => undefined);
		const currentUser = { currentUser: computed(() => ({ user_id: "recorder", name: "Recorder" })), userInitials: computed(() => "R"), userAvatar: computed(() => ""), setCurrentUser: () => undefined, resetCurrentUser: () => undefined };
		const meetingContext = {
			mediaState, participantStore, currentUser, chatStore, gridLayout, raiseHandStore, reactionStore, lobbyStore,
			sfuManager: null, processedStream: null, isInMeeting: computed(() => true), onBackgroundEffectsChanged: () => undefined, networkQuality: ref<"good" | "poor" | "critical">("good"),
		};
		return () => h(RecorderRenderer, { startedAt: config.startedAt, interruption: controller.interruption.value, messages: messages.value, meetingContext, videoManager: controller.videoManager, onPlaybackFailure: (reason: string) => controller.reportPlaybackFailure(reason), onScreenAttachment: (consumerId: string, attachment: Promise<void>) => attachment.then(pendingScreenAttachments.get(consumerId)?.resolve, pendingScreenAttachments.get(consumerId)?.reject) });
	},
});
app.use(pinia).mount("#app");
