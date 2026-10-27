<script setup lang="ts">
import { Alert, Dialog, Switch } from "frappe-ui";
import { computed, ref, watch } from "vue";
import type { RecordingPreflight } from "../composables/useRecording";
import { captureLabel, defaultCaptureOptions, type CaptureOptions } from "../utils/capturePresentation";
import { getRecordingUnavailableReason } from "../utils/recordingPresentation";

const props = defineProps<{
	preflight: RecordingPreflight | null;
	refresh: (options: CaptureOptions) => Promise<RecordingPreflight>;
	confirm: (options: CaptureOptions) => Promise<unknown>;
}>();
const open = defineModel<boolean>("open", { default: false });
const options = ref(defaultCaptureOptions());
const checking = ref(false);
const starting = ref(false);
const checkError = ref("");
const currentPreflight = ref(props.preflight);
let checkVersion = 0;
watch(() => props.preflight, (value) => { currentPreflight.value = value; });
watch(open, (value) => {
	if (value) {
		options.value = defaultCaptureOptions();
		checkError.value = "";
	}
});
watch(options, async (value) => {
	if (!open.value) return;
	const version = ++checkVersion;
	checking.value = true;
	checkError.value = "";
	try {
		const result = await props.refresh({ ...value });
		if (version === checkVersion) currentPreflight.value = result;
	} catch (error) {
		if (version === checkVersion) checkError.value = error instanceof Error ? error.message : "Could not check capture availability";
	} finally {
		if (version === checkVersion) checking.value = false;
	}
}, { deep: true });
const selected = computed(() => options.value.video_enabled || options.value.transcription_enabled);
const canStart = computed(() => selected.value && currentPreflight.value?.eligible && !checking.value && !checkError.value && !starting.value);
const actions = computed(() => [
	{
		label: `Start ${captureLabel(options.value).toLowerCase()}`,
		variant: "solid" as const,
		disabled: !canStart.value,
		loading: starting.value || checking.value,
		onClick: async ({ close }: { close: () => void }) => {
			if (!canStart.value) return;
			starting.value = true;
			try { await props.confirm({ ...options.value }); close(); }
			finally { starting.value = false; }
		},
	},
	{ label: "Cancel", disabled: starting.value, onClick: ({ close }: { close: () => void }) => close() },
]);
const unavailable = computed(() => currentPreflight.value && !currentPreflight.value.eligible ? getRecordingUnavailableReason(currentPreflight.value) : null);
const limitedByStorage = computed(() => options.value.video_enabled && currentPreflight.value && currentPreflight.value.budget_seconds < currentPreflight.value.estimated_seconds);
</script>

<template>
	<Dialog v-model:open="open" title="Recording and transcription" size="md" :actions="actions" :dismissible="!starting">
		<div class="space-y-4">
			<Switch v-model="options.video_enabled" label="Record video" :disabled="starting" />
			<Switch v-model="options.transcription_enabled" label="Transcribe speech" :disabled="starting" />
			<p class="text-p-base text-ink-gray-7">Everyone will see a notice. Selected outputs will be saved privately to the room owner's Drive. To change outputs after starting, stop and start a new capture.</p>
			<p v-if="options.transcription_enabled" class="text-p-sm text-ink-gray-6">Transcription is delivered after the conversation in the languages spoken. English and Hindi are detected automatically.</p>
			<Alert v-if="!selected" theme="amber" title="Select at least one output" />
			<Alert v-else-if="checkError" theme="red" :title="checkError" />
			<Alert v-else-if="unavailable && !checking" theme="red" :title="unavailable.title" :description="unavailable.message" />
			<Alert v-else-if="limitedByStorage && !checking" theme="amber" title="Storage may end capture early" description="Capture will stop when its available storage budget is reached." />
		</div>
	</Dialog>
</template>
