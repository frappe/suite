<script setup lang="ts">
import { Breadcrumbs } from "frappe-ui";
import { computed } from "vue";

import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";

import LucideCopy from "~icons/lucide/copy";

const props = defineProps<{
	meetingId?: string;
	meetingTitle?: string;
	isChatOpen?: boolean;
	isPeopleOpen?: boolean;
	hasUnread?: boolean;
	lobbyUserCount?: number;
}>();

const emit = defineEmits<{
	"toggle-chat": [];
	"toggle-people": [];
	"copy-meeting-id": [];
}>();

const crumbs = computed(() => [
	{
		label: "Meet",
		route: "/meet",
	},
	{
		label: props.meetingTitle || props.meetingId || "Meeting",
	},
]);

async function copyMeetingId() {
	if (props.meetingId) {
		try {
			await navigator.clipboard.writeText(props.meetingId);
		} catch {
			// ignore
		}
	}
	emit("copy-meeting-id");
}
</script>

<template>
	<div class="flex items-center justify-between px-4 py-2 shrink-0 z-30" data-testid="meeting-header">
		<!-- Left: Logo + Breadcrumb -->
		<div class="flex items-center gap-2">
			<div class="size-7 rounded-md overflow-hidden">
				<FrappeMeetingLogo class="w-full h-full" />
			</div>
			<Breadcrumbs :items="crumbs" class="text-base-medium [&_a]:text-ink-gray-9 [&_span]:text-ink-gray-9" />
		</div>

		<!-- Right: Meeting code -->
		<div class="flex items-center gap-2">
			<!-- Meeting code / copy button -->
			<button
				v-if="meetingId"
				@click="copyMeetingId"
				class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-gray-1/80 backdrop-blur-md transition-colors text-sm text-ink-gray-9 hover:bg-surface-gray-2/80"
				title="Copy meeting code"
				data-testid="header-copy-id"
			>
				<LucideCopy class="w-4 h-4" />
				<span class="whitespace-nowrap text-sm">{{ meetingId }}</span>
			</button>
		</div>
	</div>
</template>
