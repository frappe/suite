<script setup lang="ts">
import { Breadcrumbs } from "frappe-ui";
import { computed } from "vue";

import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";

const props = defineProps<{
	meetingId?: string;
	meetingTitle?: string;
	isChatOpen?: boolean;
	isPeopleOpen?: boolean;
	hasUnread?: boolean;
	lobbyUserCount?: number;
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
	</div>
</template>
