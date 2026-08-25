<template>
	<Popover v-model:open="show" side="top" align="start" arrow>
		<template #trigger>
			<ToolbarButton :title="title" :show-tooltip="showTooltip">
				<MeetInfoIcon :encrypted="isE2EEActive" />
			</ToolbarButton>
		</template>
		<div class="w-[26rem] max-w-[calc(100vw-2rem)] space-y-4 p-4">
			<div>
				<h3 class="text-base-medium text-ink-gray-9">Meeting information</h3>
				<p v-if="isE2EEActive" class="mt-1 text-sm text-ink-gray-6">
					This is an end-to-end encrypted call
				</p>
			</div>
			<div class="space-y-2">
				<p class="text-sm-medium text-ink-gray-8">Meeting ID</p>
				<ClickToCopyField :text-content="meetingId || ''" :break-lines="false" />
			</div>
			<div class="space-y-2">
				<p class="text-sm-medium text-ink-gray-8">Meeting URL</p>
				<ClickToCopyField :text-content="meetingUrl" :break-lines="false" />
			</div>
			<div v-if="e2eeFingerprint" class="space-y-2">
				<p class="text-sm-medium text-ink-gray-8">Encryption fingerprint</p>
				<ClickToCopyField :text-content="e2eeFingerprint" :break-lines="false" />
				<p class="text-xs text-ink-gray-6">
					Everyone in this meeting should see the same fingerprint
				</p>
			</div>
		</div>
	</Popover>
</template>

<script setup lang="ts">
import { Popover } from "frappe-ui";
import { computed } from "vue";
import { useE2EEState } from "../composables/useE2EEState";
import MeetInfoIcon from "../icons/MeetInfoIcon.vue";
import ClickToCopyField from "./ClickToCopyField.vue";
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
	sessionFingerprint: e2eeFingerprint,
} = useE2EEState();
const meetingUrl = computed(() => window.location.href);
const title = computed(() =>
	isE2EEActive.value
		? "Meeting information - This is an end-to-end encrypted call"
		: "Meeting information",
);
</script>
