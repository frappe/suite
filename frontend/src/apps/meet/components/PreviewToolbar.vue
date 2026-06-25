<template>
	<Transition
		enter-active-class="transition-all duration-300 ease-out"
		enter-from-class="opacity-0 transform translate-y-4"
		enter-to-class="opacity-100 transform translate-y-0"
		leave-active-class="transition-all duration-300 ease-in"
		leave-from-class="opacity-100 transform translate-y-0"
		leave-to-class="opacity-0 transform translate-y-4"
	>
		<div
			class="z-5 pointer-events-none w-auto max-w-3xl px-4 md:px-0 bottom-4 left-1/2 transform -translate-x-1/2 absolute"
		>
			<div
				class="flex items-center gap-1.5 pointer-events-auto transition-all duration-300 mx-auto px-2 py-1"
			>
				<!-- Microphone -->
				<ToolbarButton
					:title="`Toggle Audio (${$platform === 'mac' ? '⌘+D' : 'Ctrl+D'})`"
					test-id="preview-toolbar-microphone"
					@click="$emit('toggle-microphone')"
				>
					<lucide-mic-off v-if="!isMicOn" class="w-4 h-4" />
					<lucide-mic v-else class="w-4 h-4" />
				</ToolbarButton>

				<!-- Camera -->
				<ToolbarButton
					:title="`Toggle Video (${$platform === 'mac' ? '⌘+E' : 'Ctrl+E'})`"
					test-id="preview-toolbar-camera"
					@click="$emit('toggle-camera')"
				>
					<lucide-video-off v-if="!isCameraOn" class="w-4 h-4" />
					<lucide-video v-else class="w-4 h-4" />
				</ToolbarButton>

				<!-- Settings -->
				<ToolbarButton
					v-if="cameraPermissionGranted || microphonePermissionGranted"
					title="Settings"
					test-id="preview-toolbar-settings"
					@click="showSettingsDialog = true"
				>
					<lucide-settings class="w-4 h-4" />
				</ToolbarButton>
			</div>
		</div>
	</Transition>

	<SettingsDialog
		v-model="showSettingsDialog"
		:meetingId="meetingId"
		:isPreview="true"
		@device-changed="$emit('device-changed', $event)"
	/>
</template>

<script setup lang="ts">
import { usePlatform } from "../composables/usePlatform";
import SettingsDialog from "./settings/SettingsDialog.vue";
import ToolbarButton from "./ToolbarButton.vue";

const $platform = usePlatform();

defineProps({
	isMicOn: {
		type: Boolean,
		required: true,
	},
	isCameraOn: {
		type: Boolean,
		required: true,
	},
	meetingId: {
		type: String,
		default: "",
	},
	cameraPermissionGranted: {
		type: Boolean,
		default: false,
	},
	microphonePermissionGranted: {
		type: Boolean,
		default: false,
	},
});

defineEmits(["toggle-microphone", "toggle-camera", "device-changed"]);

const showSettingsDialog = defineModel({
	type: Boolean,
	default: false,
});
</script>
