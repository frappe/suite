<template>
	<div class="p-4">
 		<div v-if="error" class="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
 			<p class="text-sm text-red-400">
 				<lucide-alert-circle class="w-4 h-4 inline mr-2" />
 				{{ error }}
 			</p>
 		</div>
 		<div v-else-if="participants.length > 0" class="flex flex-col items-center">
 			<div class="relative flex mx-auto -space-x-2">
 				<div
 					v-for="participant in displayedParticipants"
 					:key="participant.user_id"
 					:style="{ zIndex: 0 }"
 				>
					<div class="ring-2 ring-surface-base rounded-full h-10 w-10 overflow-hidden bg-surface-gray-1 text-ink-gray-7 flex items-center justify-center text-base-semibold">
						<Avatar
							v-if="participant.avatar_url"
							:image="participant.avatar_url"
							size="2xl"
							shape="circle"
						/>
						<span v-else>{{ getInitials(participant.full_name) }}</span>
					</div>
 				</div>
 				<div
 					v-if="extraCount > 0"
 					:style="{ zIndex: 0 }"
 				>
					<div class="ring-2 ring-surface-base rounded-full h-10 w-10 bg-surface-gray-1 flex items-center justify-center text-ink-gray-7 text-base-semibold">
 						+{{ extraCount }}
 					</div>
 				</div>
 			</div>
			<div class="mt-4 text-base text-ink-gray-7">
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
		<div v-else>
			<p class="text-base text-ink-gray-7">
				You'll be the first to join this meeting
			</p>
		</div>
	</div>
</template>

<script setup lang="ts">
import { Avatar } from "frappe-ui";
import { computed } from "vue";
import type { ParticipantPreview } from "../types";
import { getInitials } from "../utils/text";

interface Props {
	participants: ParticipantPreview[];
	error: string | null;
	maxDisplayed: number;
}

const props = withDefaults(defineProps<Props>(), {
	participants: () => [],
	error: "",
	maxDisplayed: 3,
});

const displayedParticipants = computed(() =>
	props.participants.slice(0, props.maxDisplayed),
);

const extraCount = computed(() =>
	Math.max(0, props.participants.length - props.maxDisplayed),
);

const formattedNames = computed((): string => {
	const names = displayedParticipants.value.map((p) => p.full_name);
	const participantLength = props.participants.length;
	if (participantLength === 0) return "";
	if (participantLength === 1) return names[0];
	if (participantLength === 2) return `${names[0]} and ${names[1]}`;
	if (participantLength === 3)
		return `${names[0]}, ${names[1]} and ${names[2]}`;
	return names.join(", ");
});
</script>
