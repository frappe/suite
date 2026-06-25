<script setup lang="ts">
import { computed } from "vue";

import MiniAvatarGroup from "./MiniAvatarGroup.vue";

interface MeetingMember {
	user_id: string;
	full_name: string;
	avatar_url?: string;
}

const props = defineProps<{
	meetingId: string;
	title: string;
	date?: string;
	time?: string;
	members: MeetingMember[];
	memberCount: number;
	isSelected?: boolean;
}>();

defineEmits<{
	join: [meetingId: string];
	click: [meetingId: string];
}>();

const dateInfo = computed(() => {
	if (!props.date) return null;
	const d = new Date(props.date);
	if (isNaN(d.getTime())) return null;
	return {
		month: d.toLocaleString("en-US", { month: "short" }).toUpperCase(),
		day: d.getDate().toString(),
	};
});
</script>

<template>
	<div
		class="flex items-center gap-8 border border-outline-gray-1 px-2.5 py-2.5 transition-colors cursor-pointer first:rounded-t-xl last:rounded-b-xl hover:bg-surface-gray-1"
		:class="isSelected ? 'bg-surface-gray-2' : 'bg-surface-base'"
		@click="$emit('click', meetingId)"
	>
		<div class="flex flex-1 items-center gap-2.5 min-w-0">
			<div
				class="flex h-[38px] w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-outline-gray-1 p-1"
				:class="isSelected ? 'bg-surface-gray-2' : 'bg-surface-base'"
			>
				<span
					v-if="dateInfo"
					class="text-[11px] font-medium text-ink-red-3 uppercase tracking-[0.99px] leading-none"
				>
					{{ dateInfo.month }}
				</span>
				<span
					v-if="dateInfo"
					class="text-base font-medium text-ink-gray-8 leading-none tracking-[0.18px]"
				>
					{{ dateInfo.day }}
				</span>
			</div>

			<div class="flex flex-col gap-1.5 min-w-0">
				<span class="text-sm-medium truncate text-ink-gray-8">
					{{ title }}
				</span>
				<div class="flex items-center gap-0.5">
					<span
						v-if="time"
						class="text-sm text-ink-gray-6 whitespace-nowrap"
					>
						{{ time }}
					</span>
					<span v-if="time" class="text-ink-gray-6">·</span>
					<MiniAvatarGroup :members="members" />
				</div>
			</div>
		</div>

		<button
			v-if="isSelected"
			class="shrink-0 rounded-lg bg-surface-gray-10 px-2 py-1.5 text-sm text-ink-base whitespace-nowrap transition-colors hover:bg-surface-gray-9"
			@click.stop="$emit('join', meetingId)"
		>
			Join
		</button>
	</div>
</template>
