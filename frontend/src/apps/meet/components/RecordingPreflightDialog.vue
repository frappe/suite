<script setup lang="ts">
import { Alert, Dialog, Switch } from "frappe-ui";
import { computed, ref, watch } from "vue";
import { captureLabel, defaultCaptureOptions, type CaptureOptions } from "../utils/capturePresentation";

const props = defineProps<{
	confirm: (options: CaptureOptions) => Promise<unknown>;
}>();
const open = defineModel<boolean>("open", { default: false });
const options = ref(defaultCaptureOptions());
const starting = ref(false);
const startError = ref("");
watch(open, (value) => {
	if (value) {
		options.value = defaultCaptureOptions();
		startError.value = "";
	}
});
watch(options, () => { startError.value = ""; }, { deep: true });
const selected = computed(() => options.value.video_enabled || options.value.transcription_enabled);
const canStart = computed(() => selected.value && !starting.value);
const actions = computed(() => [
	{
		label: `Start ${captureLabel(options.value).toLowerCase()}`,
		variant: "solid" as const,
		disabled: !canStart.value,
		loading: starting.value,
		onClick: async ({ close }: { close: () => void }) => {
			if (!canStart.value) return;
			starting.value = true;
			startError.value = "";
			try {
				const result = await props.confirm({ ...options.value });
				if (result && typeof result === "object" && "status" in result && result.status === "Rejected") return;
				close();
			} catch (error) {
				startError.value = error instanceof Error ? error.message : "Could not start capture";
			} finally {
				starting.value = false;
			}
		},
	},
	{ label: "Cancel", disabled: starting.value, onClick: ({ close }: { close: () => void }) => close() },
]);
</script>

<template>
	<Dialog v-model:open="open" title="Capture" size="md" :actions="actions" :dismissible="!starting">
		<div class="space-y-4">
			<Switch v-model="options.video_enabled" label="Record video" :disabled="starting" />
			<Switch v-model="options.transcription_enabled" label="Transcribe speech" :disabled="starting" />
			<p class="text-p-base text-ink-gray-7">Everyone will be notified. Your recording and transcript will be saved to the room owner's Drive.</p>
			<Alert v-if="startError" theme="red" :title="startError" />
		</div>
	</Dialog>
</template>
