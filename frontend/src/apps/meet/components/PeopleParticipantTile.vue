<template>
	<div class="flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors hover:bg-surface-gray-2">
		<div class="flex-shrink-0">
			<div
				class="relative flex items-center justify-center rounded-full overflow-hidden bg-surface-gray-3 text-ink-gray-7 w-8 h-8"
			>
				<img
					v-if="participant.avatar"
					:src="participant.avatar"
					:alt="participant.user_name"
					class="w-full h-full object-cover"
					draggable="false"
				/>
				<span v-else class="text-sm-medium select-none">
					{{ participant.initials }}
				</span>
			</div>
		</div>

		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2">
				<span class="text-sm text-ink-gray-8 truncate">
					{{ participant.user_name }}
				</span>
				<span v-if="isCurrentUser" class="text-xs text-ink-gray-5">(You)</span>
				<Badge v-if="isHost" theme="gray" size="sm">Host</Badge>
				<Badge v-if="participant.is_guest" theme="gray" size="sm">Guest</Badge>
			</div>
		</div>

		<div class="flex items-center gap-1 flex-shrink-0">
			<!-- Raised Hand Indicator -->
			<div v-if="isHandRaised" class="flex items-center justify-center p-1.5 rounded-lg" :title="`${participant.user_name || participant.user_id} has raised their hand`">
				<div class="rounded-full bg-amber-500 p-0.5">
					<lucide-hand class="w-3.5 h-3.5 text-ink-gray-9" />
				</div>
			</div>

			<!-- Audio Mute Button -->
			<button
				class="flex items-center justify-center p-1.5 rounded-lg hover:bg-surface-gray-3 text-ink-gray-6"
				:title="participant.audio_enabled ? 'Mute' : 'Unmute'"
			>
				<lucide-mic-off v-if="!participant.audio_enabled" class="w-4 h-4" />
				<AudioIndicator
					v-else-if="stream"
					:mediaStream="stream"
					:isActive="true"
					:maxHeight="16"
					:sensitivity="3.0"
					activeColorClass="bg-ink-gray-6"
				/>
			</button>

			<!-- Host Controls -->
			<div v-if="showHostControls" class="relative">
				<Dropdown :options="hostOptions" placement="bottom-end">
					<template #default>
						<button
							class="flex items-center justify-center p-1.5 rounded-lg hover:bg-surface-gray-3 text-ink-gray-6"
						>
							<lucide-more-vertical class="w-4 h-4" />
						</button>
					</template>
				</Dropdown>
			</div>
		</div>
	</div>

	<!-- Kick Confirmation Dialog -->
	<KickParticipantDialog
		v-model="showKickDialog"
		:participant-name="participant.user_name || 'this participant'"
		@confirm="handleKickConfirm"
	/>
</template>

<script setup lang="ts">
import { Badge, Button, Dropdown } from "frappe-ui";
import { computed, ref } from "vue";
import { useAudioStream } from "../composables/useAudioLevels";
import { useMeetingContext } from "../composables/useMeetingContext";
import type { Participant } from "../utils/media/ParticipantManager";
import AudioIndicator from "./AudioIndicator.vue";
import KickParticipantDialog from "./KickParticipantDialog.vue";

interface Props {
	participant: Participant;
	isCurrentUser?: boolean;
	isHost?: boolean;
	canControlParticipant?: boolean;
	canPromoteToCohost?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	isCurrentUser: false,
	isHost: false,
	canControlParticipant: false,
	canPromoteToCohost: false,
});

const emit = defineEmits<{
	muteParticipant: [participantId: string];
	kickParticipant: [participantId: string, ban: boolean];
	lowerHand: [participantId: string];
	promoteToCohost: [participantId: string];
}>();

const meetingCtx = useMeetingContext();
const { stream } = useAudioStream(props.participant.user_id, {
	mediaState: meetingCtx?.mediaState,
	currentUser: meetingCtx?.currentUser,
});

const showKickDialog = ref(false);

const showHostControls = computed(() => {
	return props.canControlParticipant;
});

const isHandRaised = computed(() => {
	if (!meetingCtx?.raiseHandStore?.raisedHands) return false;
	return !!meetingCtx.raiseHandStore.raisedHands[props.participant.user_id];
});

const handleKickConfirm = (ban: boolean) => {
	emit("kickParticipant", props.participant.user_id, ban);
	showKickDialog.value = false;
};

const hostOptions = computed(() => {
	return [
		{
			icon: "mic-off",
			label: "Mute",
			condition: () => !!props.participant.audio_enabled,
			onClick: () => emit("muteParticipant", props.participant.user_id),
		},
		{
			icon: "slash", // TODO: switch to `hand` if we integrate Lucide instead of FeatherIcon
			label: "Lower Hand",
			condition: () => isHandRaised.value,
			onClick: () => emit("lowerHand", props.participant.user_id),
		},
		{
			icon: "user-plus",
			label: "Promote to Co-host",
			condition: () => props.canPromoteToCohost,
			onClick: () => emit("promoteToCohost", props.participant.user_id),
		},
		{
			icon: "user-x",
			label: "Remove",
			onClick: () => {
				showKickDialog.value = true;
			},
		},
	];
});
</script>
