<template>
  <div
    class="pointer-events-none w-full overflow-hidden shrink-0 transition-[height,margin] duration-500 ease-in-out"
    :class="isVisible ? 'h-[3.75rem]' : 'h-0'"
  >
    <div
      class="grid h-full w-full grid-cols-[1fr_auto_1fr] items-end px-4 transition-transform duration-500 ease-in-out pb-2"
      :class="isVisible ? 'translate-y-0' : 'translate-y-full'"
    >
      <div
        class="col-start-2 flex items-center gap-1.5 pointer-events-auto transition-all duration-500 px-2 py-1"
        role="toolbar"
        :aria-label="__('Meeting controls')"
        @mouseenter="onMouseEnter"
        @mouseleave="onMouseLeave"
      >
        <!-- Microphone -->
        <ToolbarButton
          :variant="isMicOn ? 'default' : 'muted'"
          :show-tooltip="isVisible"
          :title="__('Toggle audio ({0})', [$platform === 'mac' ? '⌘+D' : 'Ctrl+D'])"
          @click="$emit('toggle-microphone')"
        >
          <MeetMicIcon v-if="isMicOn" />
          <MeetMicOffIcon v-else />
        </ToolbarButton>

        <!-- Camera -->
        <ToolbarButton
          :variant="isCameraOn ? 'default' : 'muted'"
          :show-tooltip="isVisible"
          :title="__('Toggle video ({0})', [$platform === 'mac' ? '⌘+E' : 'Ctrl+E'])"
          @click="$emit('toggle-camera')"
        >
          <MeetCameraIcon v-if="isCameraOn" />
          <MeetCameraOffIcon v-else />
        </ToolbarButton>

        <!-- Screen Share -->
        <ToolbarButton
          v-if="canScreenShare()"
          :variant="isScreenSharing ? 'muted' : 'default'"
          :show-tooltip="isVisible"
          :title="__('Toggle screen share')"
          @click="$emit('toggle-screen-share')"
        >
          <MeetPresentPauseIcon v-if="isScreenSharing" />
          <MeetPresentIcon v-else />
        </ToolbarButton>

        <!-- Raise Hand -->
        <ToolbarButton
          :variant="isHandRaised ? 'muted' : 'default'"
          :show-tooltip="isVisible"
          :title="__('Raise hand')"
          @click="$emit('toggle-raise-hand')"
        >
          <MeetHandIcon />
        </ToolbarButton>

        <!-- Reactions -->
        <ReactionPicker
          :is-open="isReactionPickerOpen"
          @select="handleReactionSelect"
          @update:open="updateReactionPickerOpen"
        >
          <template #trigger>
            <ToolbarButton :show-tooltip="isVisible" :title="__('Reactions')" @click="() => {}">
              <MeetSmileIcon />
            </ToolbarButton>
          </template>
        </ReactionPicker>

        <!-- More Options -->
        <div class="relative">
          <Dropdown v-model:open="isMoreOpen" :options="moreOptions">
            <template #default>
              <Button
                size="lg"
                variant="ghost"
                :label="__('More options')"
                :tooltip="isVisible && !isMoreTooltipMuted ? __('More options') : undefined"
                @pointerleave="isMoreTooltipMuted = isMoreOpen"
                @blur="isMoreTooltipMuted = isMoreOpen"
              >
                <template #icon>
                  <MeetMoreIcon />
                </template>
              </Button>
            </template>
          </Dropdown>
        </div>

        <!-- End Call -->
        <ToolbarButton
          variant="active"
          :show-tooltip="isVisible"
          :title="__('End call')"
          @click="$emit('end-call')"
        >
          <MeetPhoneOffIcon class="text-ink-red-6 size-5" />
        </ToolbarButton>
      </div>

      <div
        class="col-start-3 flex items-center justify-self-end gap-1.5 pointer-events-auto transition-all duration-500 px-2 py-1"
        role="group"
        :aria-label="__('Meeting side panels')"
        @mouseenter="onMouseEnter"
        @mouseleave="onMouseLeave"
      >
        <MeetingInfoPopover
          v-if="!isMobile"
          v-model:open="showMeetingInfo"
          :meeting-id="meetingId"
          :show-tooltip="isVisible"
        />

        <!-- People -->
        <ToolbarButton
          v-if="!isMobile"
          :active="isPeopleOpen"
          :show-tooltip="isVisible"
          variant="default"
          :title="__('Show participants')"
          @click="$emit('toggle-people')"
        >
          <MeetPeopleIcon />
          <span
            v-if="lobbyUserCount && lobbyUserCount > 0"
            class="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full"
          />
        </ToolbarButton>

        <!-- Chat -->
        <ToolbarButton
          v-if="!isMobile"
          :active="isChatOpen"
          :show-tooltip="isVisible"
          variant="default"
          :title="__('Show chat')"
          @click="$emit('toggle-chat')"
        >
          <MeetChatIcon />
          <span
            v-if="hasUnread && !isChatOpen"
            data-testid="toolbar-chat-unread"
            class="absolute top-2 right-2 w-1.5 h-1.5 bg-red-500 rounded-full"
          />
        </ToolbarButton>
      </div>
    </div>
  </div>

  <SettingsDialog
    v-model:open="showSettingsDialog"
    :meeting-id="meetingId"
    :is-preview="false"
    @device-changed="$emit('device-changed', $event)"
  />
  <Dialog
    v-if="isMobile"
    v-model:open="showMeetingInfo"
    :title="__('Meeting information')"
    size="sm"
  >
    <template #default>
      <MeetingInfoContent :meeting-id="meetingId" :show-heading="false" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import LucideBug from '~icons/lucide/bug'
import LucideCaptions from '~icons/lucide/captions'
import LucideCaptionsOff from '~icons/lucide/captions-off'
import { Button, Dialog, Dropdown } from 'frappe-ui'
import { computed, onMounted, onScopeDispose, onUnmounted, ref, watch, type Component } from 'vue'

import { translate as __ } from '@/platform/translation'
import { useRootStore } from '@/stores/root'

import { useE2EEState } from '../composables/useE2EEState'
import { useResponsiveGrid } from '../composables/useResponsiveGrid'
import { autoHideToolbar } from '../data/mediaPreferences'
import MeetCameraIcon from '../icons/MeetCameraIcon.vue'
import MeetCameraOffIcon from '../icons/MeetCameraOffIcon.vue'
import MeetChatIcon from '../icons/MeetChatIcon.vue'
import MeetHandIcon from '../icons/MeetHandIcon.vue'
import MeetMicIcon from '../icons/MeetMicIcon.vue'
import MeetMicOffIcon from '../icons/MeetMicOffIcon.vue'
import MeetMoreIcon from '../icons/MeetMoreIcon.vue'
import MeetPeopleIcon from '../icons/MeetPeopleIcon.vue'
import MeetPhoneOffIcon from '../icons/MeetPhoneOffIcon.vue'
import MeetPresentIcon from '../icons/MeetPresentIcon.vue'
import MeetPresentPauseIcon from '../icons/MeetPresentPauseIcon.vue'
import MeetSmileIcon from '../icons/MeetSmileIcon.vue'
import { canScreenShare, getPlatform } from '../utils/device'
import MeetingInfoContent from './MeetingInfoContent.vue'
import MeetingInfoPopover from './MeetingInfoPopover.vue'
import ReactionPicker from './ReactionPicker.vue'
import SettingsDialog from './settings/SettingsDialog.vue'
import ToolbarButton from './ToolbarButton.vue'

const $platform = getPlatform()

interface MoreOption {
  icon: string | Component
  label: string
  onClick: () => void
}

const props = defineProps<{
  isChatOpen: boolean
  isPeopleOpen?: boolean
  hasUnread?: boolean
  lobbyUserCount?: number
  isMicOn: boolean
  isCameraOn: boolean
  isScreenSharing: boolean
  isHandRaised?: boolean
  isReactionPickerOpen?: boolean
  meetingId?: string
  meetingTitle?: string
  currentUser?: unknown
  isFullscreen?: boolean
  statsVisible?: boolean
  cameraPermissionGranted?: boolean
  microphonePermissionGranted?: boolean
  isCaptionsEnabled?: boolean
  areCaptionsAvailable: boolean
  canManageRecording?: boolean
  recordingStatus?: string
  recordingLoading?: boolean
}>()

const emit = defineEmits<{
  'toggle-chat': []
  'toggle-people': []
  'toggle-reactions': [emoji: string]
  'toggle-microphone': []
  'toggle-camera': []
  'toggle-screen-share': []
  'toggle-fullscreen': []
  'toggle-raise-hand': []
  'toggle-captions': []
  'report-problem': []
  'toggle-stats': []
  'end-call': []
  'device-changed': [event: unknown]
  'update:isReactionPickerOpen': [value: boolean]
  'visibility-change': [visible: boolean]
  'manage-recording': []
}>()

const { isMobile } = useResponsiveGrid()
const { isContextReady: isE2EEContextReady } = useE2EEState()

const moreOptions = computed(() => [
  ...(props.canManageRecording
    ? [
        {
          icon: ['Recording', 'Interrupted', 'Stopping'].includes(props.recordingStatus || '')
            ? 'lucide-circle-stop'
            : 'lucide-disc',
          label:
            props.recordingStatus === 'Pending'
              ? __('Starting recording…')
              : ['Recording', 'Interrupted', 'Stopping'].includes(props.recordingStatus || '')
                ? __('Stop recording')
                : __('Start recording'),
          disabled:
            props.recordingLoading || ['Pending', 'Stopping'].includes(props.recordingStatus || ''),
          onClick: () => {
            emit('manage-recording')
            resetHideTimer()
          },
        },
      ]
    : []),
  ...(props.areCaptionsAvailable
    ? [
        {
          icon: props.isCaptionsEnabled ? LucideCaptionsOff : LucideCaptions,
          label: props.isCaptionsEnabled ? __('Disable captions') : __('Enable captions'),
          onClick: () => {
            emit('toggle-captions')
            resetHideTimer()
          },
        },
      ]
    : []),
  {
    icon: 'lucide-activity',
    label: props.statsVisible ? __('Hide stats for nerds') : __('Stats for nerds'),
    onClick: () => {
      emit('toggle-stats')
      resetHideTimer()
    },
  },
  {
    icon: LucideBug,
    label: __('Report an issue'),
    onClick: () => {
      emit('report-problem')
      resetHideTimer(true)
    },
  },
  {
    icon: props.isFullscreen ? 'lucide-minimize' : 'lucide-maximize',
    label: props.isFullscreen ? __('Exit full screen') : __('Enter full screen'),
    onClick: () => {
      emit('toggle-fullscreen')
      resetHideTimer()
    },
  },
  ...(isMobile.value
    ? [
        {
          icon: 'lucide-info',
          label: __('Meeting information'),
          onClick: () => {
            showMeetingInfo.value = true
            resetHideTimer()
          },
        },
        {
          icon: 'lucide-users',
          label: __('People'),
          onClick: () => {
            emit('toggle-people')
          },
        },
        {
          icon: 'lucide-message-square',
          label: __('Chat'),
          onClick: () => {
            emit('toggle-chat')
          },
        },
      ]
    : []),
  {
    icon: 'lucide-settings',
    label: __('Settings'),
    onClick: openSettings,
  },
])

const isVisible = ref(true)
// A closing menu hands focus back to More, which would open its tooltip over the call. The tooltip
// stays off from the menu opening until the pointer leaves the button or focus moves on.
const isMoreOpen = ref(false)
const isMoreTooltipMuted = ref(false)
watch(isMoreOpen, (open) => {
  if (open) isMoreTooltipMuted.value = true
})
const isHovering = ref(false)
const showMeetingInfo = ref(false)
const showSettingsDialog = ref(false)
const showMeetingInfoWhenE2EEReady = ref(false)
let hideTimeout = null

const showControls = () => {
  isVisible.value = true
  resetHideTimer()
}

const resetHideTimer = (force = false) => {
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }

  if (!autoHideToolbar.value) {
    return
  }

  if (!force && (isHovering.value || props.isReactionPickerOpen)) {
    return
  }

  hideTimeout = setTimeout(() => {
    isVisible.value = false
  }, 10000)
}

function openSettings() {
  showSettingsDialog.value = true
  resetHideTimer()
}

const unregisterPaletteGroups = useRootStore().registerPaletteGroups('meet-meeting-toolbar', [
  {
    commands: [
      {
        id: 'meet-settings',
        label: __('Settings'),
        enterHint: __('open Meet settings'),
        icon: 'lucide-settings',
        keywords: ['audio', 'video', 'camera', 'microphone', 'devices'],
        run: openSettings,
      },
    ],
  },
])
onScopeDispose(unregisterPaletteGroups)

const handleActivity = () => {
  showControls()
}

const onMouseEnter = () => {
  isHovering.value = true
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }
  isVisible.value = true
}

const onMouseLeave = () => {
  isHovering.value = false
  resetHideTimer()
}

const handleShortcut = (event) => {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    emit('toggle-fullscreen')
    showControls()
    return
  }

  if ((event.ctrlKey || event.metaKey) && ['d', 'e'].includes(event.key.toLowerCase())) {
    showControls()
  }
}

const handleHostE2EEEnabled = () => {
  showMeetingInfoWhenE2EEReady.value = true
}

const showMeetingInfoForReadyE2EE = () => {
  showMeetingInfoWhenE2EEReady.value = false
  showMeetingInfo.value = true
  showControls()
}
const handleReactionSelect = (emoji) => {
  emit('toggle-reactions', emoji)

  isHovering.value = false
  updateReactionPickerOpen(false)
  resetHideTimer(true)
}

const updateReactionPickerOpen = (value) => {
  emit('update:isReactionPickerOpen', value)
}

watch(isVisible, (val) => emit('visibility-change', val))

watch([showMeetingInfoWhenE2EEReady, isE2EEContextReady], ([shouldShow, ready]) => {
  if (shouldShow && ready) {
    showMeetingInfoForReadyE2EE()
  }
})

watch(autoHideToolbar, (shouldAutoHide) => {
  if (!shouldAutoHide) {
    if (hideTimeout) {
      clearTimeout(hideTimeout)
      hideTimeout = null
    }
    isVisible.value = true
  } else {
    resetHideTimer()
  }
})

onMounted(() => {
  resetHideTimer()

  document.addEventListener('mousemove', handleActivity)
  document.addEventListener('mousedown', handleActivity)
  document.addEventListener('touchstart', handleActivity)
  document.addEventListener('touchmove', handleActivity)
  document.addEventListener('keydown', handleShortcut)
  document.addEventListener('meet:e2ee-host-enabled', handleHostE2EEEnabled)
})

onUnmounted(() => {
  if (hideTimeout) {
    clearTimeout(hideTimeout)
  }

  document.removeEventListener('mousemove', handleActivity)
  document.removeEventListener('mousedown', handleActivity)
  document.removeEventListener('touchstart', handleActivity)
  document.removeEventListener('touchmove', handleActivity)
  document.removeEventListener('keydown', handleShortcut)
  document.removeEventListener('meet:e2ee-host-enabled', handleHostE2EEEnabled)
})
</script>
