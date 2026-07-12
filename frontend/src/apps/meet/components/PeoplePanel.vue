<template>
	<Transition
		enter-active-class="transition-all duration-300 ease-out"
		enter-from-class="opacity-0 transform translate-x-full"
		enter-to-class="opacity-100 transform translate-x-0"
		leave-active-class="transition-all duration-300 ease-in"
		leave-from-class="opacity-100 transform translate-x-0"
		leave-to-class="opacity-0 transform translate-x-full"
	>
		<div v-show="open" class="h-full flex justify-end py-2.5" data-testid="people-panel-wrapper">
			<div
				class="w-[380px] bg-surface-gray-1 flex flex-col z-40 h-full rounded-md mr-2 overflow-hidden"
				data-testid="people-panel"
			>
				<div class="flex items-center justify-between gap-3 px-4 py-5 shrink-0">
					<div class="min-w-0 truncate text-sm-medium text-ink-gray-8 tracking-[0.21px]">
						People
					</div>
					<Button
						variant="ghost"
						class="text-ink-gray-6 hover:bg-surface-gray-2"
						@click="$emit('close')"
					>
						<lucide-x class="h-4 w-4 text-ink-gray-8" />
					</Button>
				</div>

				<div class="px-2 pb-2 shrink-0">
					<FormControl
						v-model="searchQuery"
						type="text"
						placeholder="Search people"
						autocomplete="off"
						data-testid="people-search"
					>
						<template #prefix>
							<lucide-search class="w-4 h-4 text-ink-gray-5" />
						</template>
					</FormControl>
				</div>

				<div class="flex-1 overflow-y-auto px-2">
					<PeopleWaitingSection
						v-if="isCreator"
						:lobbyUsers="filteredLobbyUsers"
						@approve="handleApproveLobbyUser"
						@reject="handleRejectLobbyUser"
						@approve-all="handleApproveAllLobbyUsers"
					/>

					<div
						v-if="filteredLobbyUsers.length > 0 && allVisibleParticipants.length > 0"
						class="my-2 border-t border-outline-gray-2"
					/>

					<!-- All Participants -->
					<div v-if="allVisibleParticipants.length > 0" class="flex flex-col gap-1">
						<PeopleParticipantTile
							v-for="participant in allVisibleParticipants"
							:key="participant.user_id"
							:participant="participant.participantData"
							:isCurrentUser="participant.isCurrentUser"
							:isHost="participant.isHost"
							:canControlParticipant="participant.canControlParticipant"
							@muteParticipant="handleMuteParticipant"
							@kickParticipant="handleKickParticipant"
							@lowerHand="handleLowerHand"
							@promoteToCohost="handlePromoteToCohost"
						/>
					</div>

					<div
						v-if="allVisibleParticipants.length === 0 && filteredLobbyUsers.length === 0"
						class="text-ink-gray-5 text-sm text-center mt-8 px-4"
					>
						{{ searchQuery ? "No participants found" : "No other participants" }}
					</div>
				</div>
			</div>
		</div>
	</Transition>
</template>

<script setup lang="ts">
import { Button, FormControl } from "frappe-ui";
import { computed, ref } from "vue";
import { useMeetingContext } from "../composables/useMeetingContext";
import type { Participant } from "../utils/media/ParticipantManager";
import { getInitials } from "../utils/text";
import PeopleParticipantTile from "./PeopleParticipantTile.vue";
import PeopleWaitingSection from "./PeopleWaitingSection.vue";

const meetingCtx = useMeetingContext();

interface LobbyUser {
	userId: string;
	name?: string;
	isGuest?: boolean;
	joinedAt?: number;
}

interface CurrentUser {
	user_id?: string;
	full_name?: string;
	name?: string;
	avatar?: string;
	initials?: string;
	is_guest?: boolean;
}

interface Props {
	open: boolean;
	currentUser: CurrentUser;
	participants: Record<string, Participant>;
	isMicOn: boolean;
	isCameraOn: boolean;
	creatorUserId: string;
	coHosts: string[];
	lobbyUsers?: LobbyUser[];
}

const props = withDefaults(defineProps<Props>(), {
	open: false,
	currentUser: () => ({}),
	participants: () => ({}),
	isMicOn: false,
	isCameraOn: false,
	creatorUserId: "",
	coHosts: () => [],
	lobbyUsers: undefined,
});

const emit = defineEmits<{
	close: [];
	muteParticipant: [participantId: string];
	kickParticipant: [participantId: string, ban: boolean];
	lowerHand: [participantId: string];
	promoteToCohost: [participantId: string];
	approveLobbyUser: [participantId: string];
	approveAllLobbyUsers: [participantIds: string[]];
	rejectLobbyUser: [participantId: string];
}>();

const searchQuery = ref<string>("");

const isCreator = computed(() => {
	return (
		props.currentUser.user_id === props.creatorUserId ||
		props.coHosts.includes(props.currentUser.user_id || "")
	);
});

const isHost = computed(() => {
	return props.currentUser.user_id === props.creatorUserId;
});

const lobbyUsers = computed(() => {
	if (props.lobbyUsers !== undefined) {
		return props.lobbyUsers;
	}
	return meetingCtx?.lobbyStore.lobbyUsers || [];
});

const filteredLobbyUsers = computed(() => {
	if (!searchQuery.value.trim()) {
		return lobbyUsers.value;
	}

	const query = searchQuery.value.toLowerCase().trim();
	return lobbyUsers.value.filter((user) => {
		const name = (user.name || user.userId || "").toLowerCase();
		return name.includes(query);
	});
});

const participantsList = computed(() => {
	const raisedHands = meetingCtx?.raiseHandStore.raisedHands || {};

	return Object.values(props.participants).sort((a, b) => {
		// 1. Raised hands first
		const aRaised = raisedHands[a.user_id];
		const bRaised = raisedHands[b.user_id];
		if (aRaised && !bRaised) return -1;
		if (!aRaised && bRaised) return 1;

		// 2. Among raised hands, sort by timestamp (earliest first)
		if (aRaised && bRaised) {
			const aTime = new Date(aRaised).getTime();
			const bTime = new Date(bRaised).getTime();
			return aTime - bTime;
		}

		// 3. Alphabetical by name for everyone else
		const nameA = (a.user_name || a.user_id || "").toLowerCase();
		const nameB = (b.user_name || b.user_id || "").toLowerCase();
		return nameA.localeCompare(nameB);
	});
});

const filteredParticipants = computed(() => {
	if (!searchQuery.value.trim()) {
		return participantsList.value;
	}

	const query = searchQuery.value.toLowerCase().trim();
	return participantsList.value.filter((participant) => {
		const name = (
			participant.user_name ||
			participant.user_id ||
			""
		).toLowerCase();
		return name.includes(query);
	});
});

const showCurrentUser = computed(() => {
	if (!searchQuery.value.trim()) {
		return true;
	}

	const query = searchQuery.value.toLowerCase().trim();
	const name = (
		props.currentUser?.full_name ||
		props.currentUser?.name ||
		""
	).toLowerCase();
	return name.includes(query);
});

const allVisibleParticipants = computed(() => {
	const participants = [];

	if (showCurrentUser.value) {
		participants.push({
			user_id: props.currentUser?.user_id || "",
			participantData: currentUserData.value,
			isCurrentUser: true,
			isHost: isCreator.value,
			canControlParticipant: false,
			canPromoteToCohost: false,
		});
	}

	for (const participant of filteredParticipants.value) {
		participants.push({
			user_id: participant.user_id,
			participantData: participant,
			isCurrentUser: false,
			isHost:
				participant.user_id === props.creatorUserId ||
				props.coHosts.includes(participant.user_id),
			canControlParticipant:
				isCreator.value && participant.user_id !== props.creatorUserId,
			canPromoteToCohost:
				isHost.value &&
				!participant.is_guest &&
				!props.coHosts.includes(participant.user_id),
			is_guest: participant.is_guest || false,
		});
	}

	return participants;
});

const currentUserData = computed<Participant>(() => ({
	user_id: props.currentUser?.user_id || "",
	user_name: props.currentUser?.full_name || props.currentUser?.name || "You",
	avatar: props.currentUser?.avatar || "",
	initials: getInitials(
		props.currentUser?.full_name || props.currentUser?.name || "You",
	),
	audio_enabled: props.isMicOn,
	video_enabled: props.isCameraOn,
	is_guest: props.currentUser?.is_guest || false,
}));

const totalParticipantCount = computed(() => {
	return Object.keys(props.participants).length + 1;
});

const handleMuteParticipant = (participantId: string) => {
	emit("muteParticipant", participantId);
};

const handleKickParticipant = (participantId: string, ban: boolean) => {
	emit("kickParticipant", participantId, ban);
};

const handleLowerHand = (participantId: string) => {
	emit("lowerHand", participantId);
};

const handlePromoteToCohost = (participantId: string) => {
	emit("promoteToCohost", participantId);
};

const handleApproveLobbyUser = (participantId: string) => {
	emit("approveLobbyUser", participantId);
};

const handleRejectLobbyUser = (participantId: string) => {
	emit("rejectLobbyUser", participantId);
};

const handleApproveAllLobbyUsers = () => {
	emit(
		"approveAllLobbyUsers",
		lobbyUsers.value.map((user) => user.userId),
	);
};
</script>
