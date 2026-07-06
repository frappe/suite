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
			class="z-5 pointer-events-none mt-4 flex w-full justify-center px-4 md:px-0"
		>
			<div
				class="flex items-center gap-1.5 pointer-events-auto transition-all duration-300 mx-auto px-2 py-1"
			>
				<!-- Microphone -->
				<ToolbarButton
					:variant="isMicOn ? 'default' : 'muted'"
					:title="`Toggle Audio (${$platform === 'mac' ? '⌘+D' : 'Ctrl+D'})`"
					test-id="preview-toolbar-microphone"
					@click="$emit('toggle-microphone')"
				>
					<MeetMicIcon v-if="isMicOn" />
					<MeetMicOffIcon v-else />
				</ToolbarButton>

				<!-- Camera -->
				<ToolbarButton
					:variant="isCameraOn ? 'default' : 'muted'"
					:title="`Toggle Video (${$platform === 'mac' ? '⌘+E' : 'Ctrl+E'})`"
					test-id="preview-toolbar-camera"
					@click="$emit('toggle-camera')"
				>
					<MeetCameraIcon v-if="isCameraOn" />
					<MeetCameraOffIcon v-else />
				</ToolbarButton>

				<!-- Settings -->
				<ToolbarButton
					v-if="cameraPermissionGranted || microphonePermissionGranted"
					title="Settings"
					test-id="preview-toolbar-settings"
					@click="showSettingsDialog = true"
				>
					<MeetSettingsIcon />
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
import MeetCameraIcon from "../icons/MeetCameraIcon.vue";
import MeetCameraOffIcon from "../icons/MeetCameraOffIcon.vue";
import MeetMicIcon from "../icons/MeetMicIcon.vue";
import MeetMicOffIcon from "../icons/MeetMicOffIcon.vue";
import MeetSettingsIcon from "../icons/MeetSettingsIcon.vue";
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
