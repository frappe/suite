<template>
	<Popover v-model:open="show" side="top" align="start" arrow>
		<template #trigger>
			<ToolbarButton :title="title" :show-tooltip="showTooltip">
				<MeetInfoIcon :encrypted="isE2EEActive" />
			</ToolbarButton>
		</template>
		<div class="w-[26rem] max-w-[calc(100vw-2rem)] p-4">
			<MeetingInfoContent :meeting-id="meetingId" />
		</div>
	</Popover>
</template>

<script setup lang="ts">
import { Popover } from "frappe-ui";
import { computed } from "vue";
import { useE2EEState } from "../composables/useE2EEState";
import MeetInfoIcon from "../icons/MeetInfoIcon.vue";
import MeetingInfoContent from "./MeetingInfoContent.vue";
import ToolbarButton from "./ToolbarButton.vue";

const props = withDefaults(
	defineProps<{
		open?: boolean;
		meetingId?: string;
		showTooltip?: boolean;
	}>(),
	{ showTooltip: true },
);

const emit = defineEmits<{
	"update:open": [value: boolean];
}>();

const show = computed({
	get: () => props.open,
	set: (value) => emit("update:open", value),
});

const {
	isContextReady: isE2EEActive,
} = useE2EEState();
const title = computed(() =>
	isE2EEActive.value
		? "Meeting information - This is an end-to-end encrypted call"
		: "Meeting information",
);
</script>
