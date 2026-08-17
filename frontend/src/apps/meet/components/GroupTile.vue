<template>
	<div
		class="relative bg-surface-gray-3 rounded-6 overflow-hidden min-h-0 flex flex-col gap-2 items-center justify-center cursor-pointer p-2"
		:title="tooltip"
		role="button"
		tabindex="0"
		@click="$emit('click')"
		@keydown.enter.prevent="$emit('click')"
		@keydown.space.prevent="$emit('click')"
	>
		<AvatarGroup
			:participants="avatarParticipants"
			:error="null"
			:maxDisplayed="2"
			:size="size"
		/>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AvatarGroup from "./AvatarGroup.vue";

const emit = defineEmits<{
	click: [];
}>();

const props = defineProps<{
	count: number;
	tooltip?: string;
	participants?: Array<{
		user_id: string;
		user_name?: string;
		avatar?: string | null;
		initials?: string;
	}>;
	size?: "sm" | "md" | "lg" | "xl" | "2xl";
}>();

const avatarParticipants = computed(() =>
	(props.participants || []).map((participant) => ({
		user_id: participant.user_id,
		full_name: participant.user_name || participant.initials || participant.user_id,
		avatar_url: participant.avatar ?? undefined,
	})),
);
</script>
