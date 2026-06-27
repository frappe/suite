<template>
	<div
		class="flex min-h-11 items-center gap-3 rounded-lg px-3 py-1.5 transition-colors hover:bg-surface-gray-2"
	>
		<Avatar
			size="lg"
			:image="participant.avatar"
			:label="participant.user_name || participant.user_id"
		/>

		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<span class="truncate text-sm text-ink-gray-8 tracking-[0.28px]">
					{{ participant.user_name }}
				</span>
				<span v-if="isCurrentUser" class="text-xs text-ink-gray-5">(You)</span>
			</div>
		</div>

		<div class="ml-auto flex shrink-0 items-center justify-end gap-1">
			<span
				v-if="isHost"
				class="rounded-full bg-surface-gray-4 px-1.5 py-px text-xs text-ink-gray-6 tracking-[0.24px]"
			>
				Host
			</span>
			<span
				v-if="participant.is_guest"
				class="rounded-full bg-surface-gray-4 px-1.5 py-px text-xs text-ink-gray-6 tracking-[0.24px]"
			>
				Guest
			</span>
		</div>

		<div class="flex flex-shrink-0 items-center gap-1">
			<!-- Raised Hand Indicator -->
			<div v-if="isHandRaised" class="flex items-center justify-center p-1.5 rounded-lg" :title="`${participant.user_name || participant.user_id} has raised their hand`">
				<div class="rounded-full bg-amber-500 p-0.5">
					<lucide-hand class="w-3.5 h-3.5 text-ink-gray-9" />
				</div>
			</div>

			<!-- Video Status -->
			<button
				class="flex items-center justify-center rounded-lg p-1.5 text-ink-gray-6 hover:bg-surface-gray-3"
				:title="participant.video_enabled ? 'Camera on' : 'Camera off'"
			>
				<MeetCameraIcon :class="participant.video_enabled ? 'size-4' : 'size-4 text-[#E54E17]'" />
			</button>

			<!-- Audio Mute Button -->
			<button
				class="flex items-center justify-center rounded-lg p-1.5 text-ink-gray-6 hover:bg-surface-gray-3"
				:title="participant.audio_enabled ? 'Mute' : 'Unmute'"
				@click="participant.audio_enabled && canControlParticipant ? emit('muteParticipant', participant.user_id) : undefined"
			>
				<MeetMicIcon :class="participant.audio_enabled ? 'size-4' : 'size-4 text-[#E54E17]'" />
			</button>

			<!-- Host Controls -->
			<div v-if="canControlParticipant" class="relative">
				<Dropdown :options="hostOptions" placement="bottom-end">
					<template #default>
						<button
							class="flex items-center justify-center rounded-lg p-1.5 text-ink-gray-6 hover:bg-surface-gray-3"
						>
							<lucide-more-horizontal class="w-4 h-4" />
						</button>
					</template>
				</Dropdown>
			</div>
			<button
				v-else
				class="flex items-center justify-center rounded-lg p-1.5 text-ink-gray-6 hover:bg-surface-gray-3"
			>
				<lucide-more-horizontal class="w-4 h-4" />
			</button>
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
import { Avatar, Dropdown } from "frappe-ui";
import { computed, ref } from "vue";
import { useMeetingContext } from "../composables/useMeetingContext";
import MeetCameraIcon from "../icons/MeetCameraIcon.vue";
import MeetMicIcon from "../icons/MeetMicIcon.vue";
import type { Participant } from "../utils/media/ParticipantManager";
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
const showKickDialog = ref(false);

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
