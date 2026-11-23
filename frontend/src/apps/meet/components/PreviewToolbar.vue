<template>
  <div
    class="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-4 md:px-0"
  >
    <div class="pointer-events-auto mx-auto flex items-center gap-1.5 transition-all duration-300">
      <!-- Microphone -->
      <ToolbarButton
        :variant="isMicOn ? 'default' : 'muted'"
        :title="__('Toggle audio ({0})', [$platform === 'mac' ? '⌘+D' : 'Ctrl+D'])"
        @click="$emit('toggle-microphone')"
      >
        <MeetMicIcon v-if="isMicOn" />
        <MeetMicOffIcon v-else />
      </ToolbarButton>

      <!-- Camera -->
      <ToolbarButton
        :variant="isCameraOn ? 'default' : 'muted'"
        :title="__('Toggle video ({0})', [$platform === 'mac' ? '⌘+E' : 'Ctrl+E'])"
        @click="$emit('toggle-camera')"
      >
        <MeetCameraIcon v-if="isCameraOn" />
        <MeetCameraOffIcon v-else />
      </ToolbarButton>

      <!-- Settings -->
      <ToolbarButton
        v-if="cameraPermissionGranted || microphonePermissionGranted"
        :title="__('Settings')"
        @click="showSettingsDialog = true"
      >
        <MeetSettingsIcon />
      </ToolbarButton>
    </div>
  </div>

  <SettingsDialog
    v-model:open="showSettingsDialog"
    :meeting-id="meetingId"
    :is-preview="true"
    @device-changed="$emit('device-changed', $event)"
  />
</template>

<script setup lang="ts">
import { onScopeDispose } from 'vue'

import { translate as __ } from '@/platform/translation'
import { useRootStore } from '@/stores/root'

import MeetCameraIcon from '../icons/MeetCameraIcon.vue'
import MeetCameraOffIcon from '../icons/MeetCameraOffIcon.vue'
import MeetMicIcon from '../icons/MeetMicIcon.vue'
import MeetMicOffIcon from '../icons/MeetMicOffIcon.vue'
import MeetSettingsIcon from '../icons/MeetSettingsIcon.vue'
import { getPlatform } from '../utils/device'
import SettingsDialog from './settings/SettingsDialog.vue'
import ToolbarButton from './ToolbarButton.vue'

const $platform = getPlatform()

const props = defineProps({
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
    default: '',
  },
  cameraPermissionGranted: {
    type: Boolean,
    default: false,
  },
  microphonePermissionGranted: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['toggle-microphone', 'toggle-camera', 'device-changed'])

const showSettingsDialog = defineModel({
  type: Boolean,
  default: false,
})

const unregisterPaletteGroups = useRootStore().registerPaletteGroups('meet-preview-toolbar', () =>
  props.cameraPermissionGranted || props.microphonePermissionGranted
    ? [
        {
          commands: [
            {
              id: 'meet-settings',
              label: __('Settings'),
              enterHint: 'open meet settings',
              icon: 'lucide-settings',
              keywords: ['audio', 'video', 'camera', 'microphone', 'devices'],
              run: () => (showSettingsDialog.value = true),
            },
          ],
        },
      ]
    : [],
)
onScopeDispose(unregisterPaletteGroups)
</script>
