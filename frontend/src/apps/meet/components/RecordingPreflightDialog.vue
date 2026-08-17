<script setup lang="ts">
import { Alert, Dialog } from "frappe-ui";
import { computed } from "vue";
import type { RecordingPreflight } from "../composables/useRecording";
import { getRecordingUnavailableReason } from "../utils/recordingPresentation";

const props = defineProps<{
	preflight: RecordingPreflight | null;
	confirm: () => Promise<unknown>;
}>();
const open = defineModel<boolean>("open", { default: false });

const actions = computed(() => {
	const close = {
		label: props.preflight?.eligible ? "Cancel" : "Close",
		variant: "subtle" as const,
		onClick: ({ close }: { close: () => void }) => close(),
	};
	if (!props.preflight?.eligible) return [close];
	return [
		{
			label: "Start recording",
			variant: "solid" as const,
			theme: "red" as const,
			onClick: async ({ close }: { close: () => void }) => {
				await props.confirm();
				close();
			},
		},
		close,
	];
});

const limitedByStorage = computed(
	() =>
		Boolean(props.preflight) &&
		(props.preflight?.budget_seconds || 0) < (props.preflight?.estimated_seconds || 0),
);
const unavailable = computed(() =>
	props.preflight && !props.preflight.eligible
		? getRecordingUnavailableReason(props.preflight)
		: null,
);

</script>

<template>
	<Dialog
		v-model:open="open"
		title="Start recording?"
		theme="red"
		size="md"
		:actions="actions"
	>
		<div v-if="preflight" class="space-y-4">
			<p class="text-p-base text-ink-gray-7">
				Everyone in the meeting will see a recording notice. The video will be saved privately to the room owner's Drive.
			</p>

			<Alert v-if="unavailable" theme="red" :title="unavailable.title" :description="unavailable.message" />
			<Alert
				v-else-if="limitedByStorage"
				theme="amber"
				title="Storage may end the recording early"
				description="Recording will stop when its available storage budget is reached."
			/>
		</div>
	</Dialog>
</template>
