<script setup lang="ts">
import { Avatar } from "frappe-ui";
import { computed } from "vue";

interface MeetingMember {
	user_id: string;
	full_name: string;
	avatar_url?: string;
}

const props = withDefaults(
	defineProps<{
		members: MeetingMember[];
		maxDisplayed?: number;
	}>(),
	{ maxDisplayed: 3 },
);

const displayedMembers = computed(() =>
	props.members.slice(0, props.maxDisplayed),
);
const extraCount = computed(
	() => Math.max(0, props.members.length - props.maxDisplayed),
);

function getInitials(name: string): string {
	const parts = name.trim().split(/\s+/);
	if (parts.length >= 2) {
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}
	return name.slice(0, 2).toUpperCase();
}
</script>

<template>
	<div class="flex items-center isolate">
		<div
			v-for="(member, i) in displayedMembers"
			:key="member.user_id"
			class="flex items-center justify-center rounded-full border-2 border-outline-gray-1"
			:style="{ zIndex: displayedMembers.length - i, marginLeft: i > 0 ? '-2px' : 0 }"
		>
			<Avatar
				:image="member.avatar_url"
				:label="getInitials(member.full_name)"
				size="xs"
				shape="circle"
			/>
		</div>
		<div
			v-if="extraCount > 0"
			class="flex h-4 w-4 items-center justify-center rounded-full border-2 border-outline-gray-1 bg-surface-gray-3 text-[11px] font-medium text-ink-gray-7 uppercase"
			:style="{ zIndex: 0, marginLeft: '-2px' }"
		>
			{{ extraCount }}
		</div>
	</div>
</template>
