<template>
	<div
		:class="showText ? (alignment === 'left' ? 'min-h-[4.5rem] py-4' : 'min-h-[4.5rem] p-4') : ''"
	>
		<div v-if="error" class="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
			<p class="text-sm text-red-400">
				<lucide-alert-circle class="w-4 h-4 inline mr-2" />
				{{ error }}
			</p>
		</div>
		<div
			v-else-if="!loading && participants.length > 0"
			class="flex"
			:class="
				alignment === 'left'
					? 'flex-row items-center gap-4'
					: 'flex-col items-center'
			"
		>
			<div
				class="relative isolate flex"
				:class="[spacingClass, alignment === 'center' ? 'mx-auto' : '']"
			>
				<div
					v-for="(participant, index) in displayedParticipants"
					:key="participant.user_id"
					:style="{ zIndex: avatarZIndex(index) }"
				>
					<div
						class="ring-2 ring-outline-gray-1 rounded-full overflow-hidden flex items-center justify-center"
						:class="avatarWrapperClasses"
					>
						<MeetAvatar
							:image="participant.avatar_url"
							:label="participant.full_name"
							:size="size"
							shape="circle"
						/>
					</div>
				</div>
				<div
					v-if="extraCount > 0"
					:style="{ zIndex: extraAvatarZIndex }"
				>
					<div
						class="ring-2 ring-outline-gray-1 rounded-full bg-surface-gray-1 flex items-center justify-center text-ink-gray-7 text-base-semibold"
						:class="extraAvatarWrapperClasses"
					>
						+{{ extraCount }}
					</div>
				</div>
			</div>
			<div
				v-if="showText"
				class="text-base text-ink-gray-7"
				:class="alignment === 'center' ? 'mt-4' : ''"
			>
				<span v-if="displayedParticipants.length > 0">
					{{ formattedNames }}
				</span>
				<span v-if="extraCount > 0">
					{{ displayedParticipants.length > 0 ? ' and ' : '' }}{{ extraCount }} other{{ extraCount > 1 ? 's' : '' }}
				</span>
				<span v-if="displayedParticipants.length > 0">
					{{ displayedParticipants.length > 1 ? ' are' : ' is' }}
				</span>
				in the meeting
			</div>
		</div>
		<div v-else-if="!loading && showText" class="flex h-10 items-center">
			<p class="text-base text-ink-gray-7">
				You'll be the first to join this meeting
			</p>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import MeetAvatar from "./MeetAvatar.vue";

type AvatarGroupSize = "sm" | "md" | "lg" | "xl" | "2xl";
type StackDirection = "left" | "right";

interface AvatarGroupParticipant {
	user_id: string;
	full_name: string;
	avatar_url?: string;
}

interface Props {
	participants: AvatarGroupParticipant[];
	error: string | null;
	loading?: boolean;
	maxDisplayed: number;
	size?: AvatarGroupSize;
	stackDirection?: StackDirection;
	alignment?: "left" | "center";
	showText?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	participants: () => [],
	error: "",
	loading: false,
	maxDisplayed: 3,
	size: "2xl",
	stackDirection: "right",
	alignment: "center",
	showText: false,
});

const sizeClasses: Record<AvatarGroupSize, string> = {
	sm: "h-4 w-4 text-[9px]",
	md: "h-5 w-5 text-xs",
	lg: "h-6 w-6 text-xs",
	xl: "h-8 w-8 text-sm",
	"2xl": "h-10 w-10",
};

const extraSizeClasses: Record<AvatarGroupSize, string> = {
	sm: "h-4 w-4 text-[10px]",
	md: "h-5 w-5 text-xs",
	lg: "h-6 w-6 text-xs",
	xl: "h-8 w-8 text-sm",
	"2xl": "h-10 w-10",
};

const spacingClasses: Record<AvatarGroupSize, string> = {
	sm: "-space-x-0.5",
	md: "-space-x-1",
	lg: "-space-x-1.5",
	xl: "-space-x-2",
	"2xl": "-space-x-2",
};

const avatarWrapperClasses = computed(() => sizeClasses[props.size]);
const extraAvatarWrapperClasses = computed(() => extraSizeClasses[props.size]);
const spacingClass = computed(() => spacingClasses[props.size]);

const displayedParticipants = computed(() =>
	props.participants.slice(0, props.maxDisplayed),
);

const extraCount = computed(() =>
	Math.max(0, props.participants.length - props.maxDisplayed),
);

const avatarZIndex = (index: number) =>
	props.stackDirection === "right"
		? index + 1
		: displayedParticipants.value.length - index + (extraCount.value ? 1 : 0);

const extraAvatarZIndex = computed(() =>
	props.stackDirection === "right" ? displayedParticipants.value.length + 1 : 1,
);

const formattedNames = computed((): string => {
	const names = displayedParticipants.value.map((p) => p.full_name);
	const participantLength = props.participants.length;
	if (participantLength === 0) return "";
	if (extraCount.value > 0) return names.join(", ");
	if (participantLength === 1) return names[0];
	if (participantLength === 2) return `${names[0]} and ${names[1]}`;
	if (participantLength === 3)
		return `${names[0]}, ${names[1]} and ${names[2]}`;
	return names.join(", ");
});
</script>
