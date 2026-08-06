import type { InjectionKey, Ref } from "vue";
import { inject, provide } from "vue";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import type { ChatStore } from "./useChatStore";
import type { CurrentUser } from "./useCurrentUser";
import type { GridLayout } from "./useGridLayout";
import type { LobbyStore } from "./useLobbyStore";
import type { MediaState } from "./useMediaState";
import type { ParticipantStore } from "./useParticipantStore";
import type { RaiseHandStore } from "./useRaiseHandStore";
import type { ReactionStore } from "./useReactionStore";
import type { NetworkQuality } from "./useNetworkQuality";

interface MeetingContext {
	mediaState: MediaState;
	participantStore: ParticipantStore;
	currentUser: CurrentUser;
	chatStore: ChatStore;
	gridLayout: GridLayout;
	raiseHandStore: RaiseHandStore;
	reactionStore: ReactionStore;
	lobbyStore: LobbyStore;
	sfuManager: SFUMeetingManager | null;
	processedStream: MediaStream | null;
	isInMeeting: ReturnType<() => import("vue").ComputedRef<boolean>>;
	onBackgroundEffectsChanged: () => void;
	networkQuality: Ref<NetworkQuality>;
	localNetworkQuality: Ref<string>;
}

const MEETING_CONTEXT_KEY: InjectionKey<MeetingContext> =
	Symbol("meeting-context");

export function provideMeetingContext(context: MeetingContext): void {
	provide(MEETING_CONTEXT_KEY, context);
}

export function useMeetingContext(): MeetingContext | null {
	const context = inject(MEETING_CONTEXT_KEY, null);
	return context;
}
