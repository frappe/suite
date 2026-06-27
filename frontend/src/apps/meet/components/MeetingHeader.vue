<script setup lang="ts">
import { Breadcrumbs } from "frappe-ui";
import { computed } from "vue";

import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";

const props = defineProps<{
	meetingId?: string;
	meetingTitle?: string;
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
	<div class="flex items-center justify-between px-4 py-4 shrink-0 z-30">
		<!-- Left: Logo + Breadcrumb -->
		<div class="flex items-center gap-2">
			<div class="size-7 rounded-md overflow-hidden">
				<FrappeMeetingLogo class="w-full h-full" />
			</div>
			<Breadcrumbs :items="crumbs" />
		</div>
		<!-- Right: optional slot -->
		<div v-if="$slots.right" class="flex items-center gap-2">
			<slot name="right" />
		</div>
	</div>
</template>
