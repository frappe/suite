<template>
  <div
    class="fixed inset-0 h-[100dvh] flex flex-col overflow-hidden bg-surface-base text-ink-gray-9"
    data-meeting-component
    data-theme="dark"
  >
    <div
      v-if="!hasConnectionError && !connectionState.connectionMoved"
      class="shrink-0 overflow-hidden transition-[height] duration-500 ease-in-out"
      :class="headerVisible ? 'h-11' : 'h-0'"
    >
      <MeetingHeader :meeting-id="meetingId" :meeting-title="meetingTitle">
        <template #right>
          <RecordingIndicator
            v-if="!showPreview && recording.isCapturing.value && recording.state.value"
            :recording="recording.state.value"
            :can-stop="isCurrentUserHost || isCurrentUserCohost"
            @click="handleRecordingAction"
          />
          <Button
            v-if="showPreview"
            size="sm"
            icon-left="lucide-link-2"
            :label="__('Copy link')"
            @click="copyMeetingLink"
          />
          <Button
            v-if="showPreview && !session.isLoggedIn"
            variant="ghost"
            size="sm"
            @click="redirectToLogin"
          >
            {{ __('Sign in') }}
          </Button>
        </template>
      </MeetingHeader>
    </div>

    <MeetStatusScreen
      v-if="connectionState.connectionMoved"
      icon="lucide-monitor-smartphone"
      :title="__('Meeting moved to another device')"
      :description="
        __('Your audio and video have stopped here because you joined from another device.')
      "
      :action-label="__('Back to Meet')"
      action-icon="lucide-arrow-left"
      @action="router.push('/meet')"
    />

    <!-- The reason can be setup detail (a missing SFU secret); it is logged, not shown. -->
    <MeetStatusScreen
      v-else-if="hasConnectionError"
      icon="lucide-circle-alert"
      tone="danger"
      :title="__('Could not join the meeting')"
      :description="__('Something stopped the call from starting. Try again in a moment.')"
      :action-label="__('Try again')"
      @action="resetToPreview"
    />

    <template v-else>
      <!-- Preview mode -->
      <MeetingPreview
        v-if="showPreview"
        :meeting-id="meetingId"
        :meeting-title="givenTitle"
        :is-camera-on="mediaState.isCameraOn"
        :is-mic-on="mediaState.isMicOn"
        :media-stream="mediaState.localStream"
        :camera-permission-granted="mediaState.cameraPermissionGranted"
        :microphone-permission-granted="mediaState.microphonePermissionGranted"
        :is-connecting="isInitializingPreview || sfuConnection.isConnecting.value"
        :user-initials="currentUser.userInitials.value"
        :user-avatar="currentUser.userAvatar.value"
        :current-user-name="
          currentUser.currentUser.value?.full_name || currentUser.currentUser.value?.name
        "
        :guest-auth-token="connectionState.guestAuthToken"
        :is-waiting-for-approval="lobbyStore.isWaitingForApproval"
        :set-local-video-ref="mediaControls.setLocalVideoRef"
        @toggle-microphone="mediaControls.toggleMicrophone()"
        @toggle-camera="mediaControls.toggleCamera()"
        @join-from-preview="joinMeetingFromPreview"
        @guest-join-complete="handleGuestJoinComplete"
        @leave-waiting-room="leaveWaitingRoom"
        @try-join-again="tryJoinAgain"
        @device-changed="handleDeviceChanged"
      />

      <!-- Main meeting interface -->
      <template v-else>
        <div class="relative grid flex-1 min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
          <div
            class="grid flex-1 min-h-0 transition-[grid-template-columns] duration-300 ease-out relative"
            :style="{
              '--panel-width': panelWidth,
              gridTemplateColumns: 'minmax(0, 1fr) var(--panel-width)',
            }"
          >
            <div class="flex flex-col min-h-0 relative">
              <!-- Video area -->
              <div class="p-2.5 flex flex-col flex-1 min-h-0 text-white relative">
                <div
                  v-if="e2eeJoinPendingMessage"
                  class="flex h-full flex-col items-center justify-center px-4 py-12 text-center"
                  role="status"
                  aria-live="polite"
                  data-testid="e2ee-join-pending-state"
                >
                  <h1 class="text-md-medium text-ink-gray-8">
                    {{ e2eeJoinTitle }}
                  </h1>
                  <p class="mt-1 max-w-sm text-p-base text-ink-gray-7">
                    {{ e2eeJoinPendingMessage }}
                  </p>
                  <Badge class="mt-3" variant="subtle" theme="gray">
                    <template #prefix>
                      <span class="lucide-lock size-3.5" aria-hidden="true" />
                    </template>
                    {{ __('End-to-end encrypted') }}
                  </Badge>
                </div>
                <MeetingLayout v-else @open-people-panel="togglePeople" />
                <CaptionOverlay
                  v-if="!e2eeJoinPendingMessage"
                  :is-captions-enabled="isCaptionsEnabled"
                  :lines="captionLines"
                  :participants="participantStore.participants"
                  :current-user="currentUser.currentUser.value"
                />
              </div>
            </div>

            <!-- Panel Container -->
            <Transition
              enter-active-class="transition-opacity duration-300 ease-out"
              enter-from-class="opacity-0"
              enter-to-class="opacity-100"
              leave-active-class="transition-opacity duration-300 ease-in"
              leave-from-class="opacity-100"
              leave-to-class="opacity-0"
            >
              <div
                v-if="activePanel"
                class="h-full overflow-hidden z-50 md:z-auto bg-surface-base/50 backdrop-blur-sm md:bg-transparent"
                :class="{
                  'absolute inset-0 w-full': isMobile,
                  relative: !isMobile,
                  'md:relative': true,
                }"
                :style="{ width: isMobile ? '100%' : '24rem' }"
              >
                <!-- Chat Panel -->
                <ChatPanel
                  v-if="activePanel === 'chat'"
                  :open="true"
                  :messages="chatStore.chatMessages"
                  :avatar-by-user="participantAvatars"
                  :name-by-user="participantNames"
                  :user-id="(currentUser.currentUser.value?.user_id ?? '') || ''"
                  :user-name="
                    (currentUser.currentUser.value?.full_name as string) ||
                    (currentUser.currentUser.value?.name as string) ||
                    __('You')
                  "
                  :is-host="isCurrentUserHost"
                  :is-cohost="isCurrentUserCohost"
                  :is-guest="isGuestSession"
                  :host-only-chat="chatStore.hostOnlyChat"
                  :pinned-message="chatStore.pinnedMessage"
                  :send-message="chat.onSendChat"
                  :reactions-by-message="chatStore.reactionsByMessage"
                  :expired-pinned-message-id="chatStore.expiredPinnedMessageId"
                  :has-unavailable-encrypted-history="chatStore.hasUnavailableEncryptedHistory"
                  :set-reaction="chat.setReaction"
                  @close="toggleChat"
                  @pin="chat.pinMessage"
                  @unpin="unpinChatMessage"
                />

                <!-- People Panel -->
                <PeoplePanel
                  v-if="activePanel === 'people'"
                  :open="true"
                  :current-user="currentUser.currentUser.value"
                  :participants="participantsForPeoplePanel"
                  :is-mic-on="mediaState.isMicOn"
                  :is-camera-on="mediaState.isCameraOn"
                  :creator-user-id="meetingOwner"
                  :co-hosts="meetingCoHosts"
                  :lobby-users="lobbyStore.lobbyUsers"
                  @close="togglePeople"
                  @mute-participant="handleMuteParticipant"
                  @kick-participant="handleKickParticipant"
                  @lower-hand="handleLowerHand"
                  @promote-to-cohost="handlePromoteToCohost"
                  @approve-lobby-user="handleApproveLobbyUser"
                  @approve-all-lobby-users="handleApproveAllLobbyUsers"
                  @reject-lobby-user="handleRejectLobbyUser"
                />
              </div>
            </Transition>
          </div>

          <!-- Meeting controls live in their own row so tiles resize without JS padding -->
          <div class="pointer-events-none min-h-0">
            <!-- Meeting controls -->
            <MeetingToolbar
              :is-chat-open="chatStore.isChatOpen"
              :is-people-open="isPeopleOpen"
              :has-unread="chatStore.hasUnreadMessages"
              :lobby-user-count="lobbyStore.lobbyUsers?.length || 0"
              :is-mic-on="mediaState.isMicOn"
              :is-camera-on="mediaState.isCameraOn"
              :is-screen-sharing="mediaState.isScreenSharing"
              :is-fullscreen="isFullscreen"
              :stats-visible="showStatsForNerds"
              :is-hand-raised="isHandRaised"
              :is-reaction-picker-open="isReactionPickerOpen"
              :is-captions-enabled="isCaptionsEnabled"
              :are-captions-available="areCaptionsAvailable"
              :meeting-id="meetingId"
              :meeting-title="meetingTitle"
              :current-user="currentUser.currentUser.value"
              :camera-permission-granted="mediaState.cameraPermissionGranted"
              :microphone-permission-granted="mediaState.microphonePermissionGranted"
              :can-manage-recording="
                recording.globalEnabled.value && (isCurrentUserHost || isCurrentUserCohost)
              "
              :recording-status="recording.state.value?.status"
              :recording-loading="recording.startLoading.value || recording.stopLoading.value"
              @update:is-reaction-picker-open="isReactionPickerOpen = $event"
              @toggle-chat="toggleChat"
              @toggle-people="togglePeople"
              @toggle-reactions="toggleReactions($event)"
              @toggle-microphone="mediaControls.toggleMicrophone()"
              @toggle-camera="mediaControls.toggleCamera()"
              @toggle-screen-share="mediaControls.toggleScreenShare()"
              @toggle-fullscreen="toggleFullscreen"
              @toggle-raise-hand="raiseHand.toggleRaiseHand()"
              @toggle-captions="toggleCaptions"
              @report-problem="handleReportProblem"
              @toggle-stats="toggleStatsForNerds"
              @end-call="confirmAndEndCall"
              @device-changed="handleDeviceChanged"
              @visibility-change="isToolbarVisible = $event"
              @manage-recording="handleRecordingAction"
            />
          </div>
        </div>

        <StatsForNerdsOverlay v-if="showStatsForNerds" />

        <LobbyOverlay
          v-if="(isInLobby || isWaitingForApproval) && !isRejected"
          @leave="leaveLobby"
        />

        <RejectionOverlay v-if="isRejected && isGuestSession" @leave="goHome" />
      </template>
    </template>

    <MeetingPictureInPicture
      :active="
        sfuConnection.isSetupComplete.value &&
        !showPreview &&
        !hasConnectionError &&
        !connectionState.connectionMoved &&
        !canLeaveMeeting
      "
      :mic-on="mediaState.isMicOn"
      :camera-on="mediaState.isCameraOn"
      @toggle-camera="mediaControls.toggleCamera()"
      @toggle-microphone="mediaControls.toggleMicrophone()"
      @leave="confirmAndEndCall"
    />

    <!-- Join request notifications -->
    <JoinRequestNotifications
      :waiting-users="lobbyUsersForNotifications"
      @approve-user="lobby.approveUser"
      @reject-user="lobby.rejectUser"
    />

    <RecordingPreflightDialog
      v-model:open="recordingDialogOpen"
      :confirm="recording.start"
      :e2ee="e2eeState.isContextReady.value"
    />
    <RecordingStopDialog
      v-model="recordingStopDialogOpen"
      :loading="recording.stopLoading.value"
      :recording="recording.state.value"
      @confirm="confirmRecordingStop"
    />
  </div>
</template>

<script setup lang="ts">
import { Badge, Button, toast, usePageMeta } from 'frappe-ui'
import {
  computed,
  h,
  onMounted,
  onScopeDispose,
  onUnmounted,
  provide,
  ref,
  toRef,
  watch,
  watchEffect,
} from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'

import { api, client, useQuery } from '@/api'
import { session, userResource } from '@/boot/session'
import { appPageMeta } from '@/platform/page-meta'
import { translate as __ } from '@/platform/translation'
import { useRootStore } from '@/stores/root'
import { confirmLeave } from '@/utils/confirmLeave'

import CaptionOverlay from '../components/CaptionOverlay.vue'
import ChatPanel from '../components/ChatPanel.vue'
import JoinRequestNotifications from '../components/JoinRequestNotifications.vue'
import LobbyOverlay from '../components/LobbyOverlay.vue'
import MeetAvatar from '../components/MeetAvatar.vue'
import MeetingHeader from '../components/MeetingHeader.vue'
import MeetingLayout from '../components/MeetingLayout.vue'
import MeetingPictureInPicture from '../components/MeetingPictureInPicture.vue'
import MeetingPreview from '../components/MeetingPreview.vue'
import MeetingToolbar from '../components/MeetingToolbar.vue'
import MeetStatusScreen from '../components/MeetStatusScreen.vue'
import PeoplePanel from '../components/PeoplePanel.vue'
import RecordingIndicator from '../components/RecordingIndicator.vue'
import RecordingPreflightDialog from '../components/RecordingPreflightDialog.vue'
import RecordingStopDialog from '../components/RecordingStopDialog.vue'
import RejectionOverlay from '../components/RejectionOverlay.vue'
import StatsForNerdsOverlay from '../components/StatsForNerdsOverlay.vue'
import { useBackgroundEffects } from '../composables/useBackgroundEffects'
import { useCaptions } from '../composables/useCaptions'
import { useChat } from '../composables/useChat'
import { useChatStore } from '../composables/useChatStore'
import { useConnectionState } from '../composables/useConnectionState'
import { useCurrentUser } from '../composables/useCurrentUser'
import { useE2EEState } from '../composables/useE2EEState'
import { useGridLayout } from '../composables/useGridLayout'
import { meetingControls } from '../composables/useKeyboardShortcuts'
import { useLobby } from '../composables/useLobby'
import { useLobbyStore } from '../composables/useLobbyStore'
import { useMediaControls } from '../composables/useMediaControls'
import {
  findActiveScreenShare,
  replaceActiveScreenShare,
  useMediaState,
} from '../composables/useMediaState'
import { provideMeetingContext } from '../composables/useMeetingContext'
import { useMeetingHandlers } from '../composables/useMeetingHandlers'
import { useNetworkQuality } from '../composables/useNetworkQuality'
import { useNoiseCancellation } from '../composables/useNoiseCancellation'
import { useParticipantStore } from '../composables/useParticipantStore'
import { pollKey, usePoll } from '../composables/usePoll.js'
import { usePollStore } from '../composables/usePollStore.js'
import { useRaiseHand } from '../composables/useRaiseHand'
import { useRaiseHandStore } from '../composables/useRaiseHandStore'
import { useReactions } from '../composables/useReactions'
import { useReactionStore } from '../composables/useReactionStore'
import { useRecording } from '../composables/useRecording'
import { useResponsiveGrid } from '../composables/useResponsiveGrid'
import { useSFUConnection, type SFUScreenShareData } from '../composables/useSFUConnection'
import { autoHideToolbar, selectedSpeakerId } from '../data/mediaPreferences'
import { setShowStatsForNerds, showStatsForNerds } from '../data/statsPreferences'
import { useSocket } from '../socket'
import { refusalOr } from '../utils/error'
import { deviceManager } from '../utils/media/DeviceManager'
import type { Participant } from '../utils/media/ParticipantManager'

// Router
const route = useRoute()
const router = useRouter()
const meetingId = computed(() =>
  Array.isArray(route.params.meetingId)
    ? (route.params.meetingId[0] ?? '')
    : route.params.meetingId,
)
function redirectToLogin() {
  const path = window.location.pathname.startsWith('/meet')
    ? window.location.pathname
    : `/meet${window.location.pathname}`
  window.location.href = `/login?redirect-to=${encodeURIComponent(path)}`
}
async function copyMeetingLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    toast.success(__('Meeting link copied'))
  } catch {
    toast.error(__('Could not copy meeting link'))
  }
}
const unregisterPaletteGroups = useRootStore().registerPaletteGroups('meet-meeting', [
  {
    commands: [
      {
        id: 'meet-copy-link',
        label: __('Copy meeting link'),
        enterHint: __('copy meeting link'),
        icon: 'lucide-link-2',
        keywords: ['share', 'url'],
        run: copyMeetingLink,
      },
    ],
  },
])
onScopeDispose(unregisterPaletteGroups)

// --- Stores (singletons) ---
const connectionState = useConnectionState()
// Read before the first render and before resetting the shared connection store.
const isPreparingAutoJoin = ref(session.isLoggedIn && connectionState.justCreated)
const currentUser = useCurrentUser()
const mediaState = useMediaState()
const participantStore = useParticipantStore()
const chatStore = useChatStore()
const pollStore = usePollStore()
const lobbyStore = useLobbyStore()
const reactionStore = useReactionStore()
const raiseHandStore = useRaiseHandStore()
const gridLayout = useGridLayout(mediaState)

// --- Lobby notification tracking ---
const notifiedLobbyUsers = ref(new Set<string>())

const isCurrentUserHost = ref(false)
const isCurrentUserCohost = ref(false)
const recording = useRecording(meetingId.value, { signedIn: () => session.isLoggedIn })
const recordingDialogOpen = ref(false)
const recordingStopDialogOpen = ref(false)
function handleRecordingAction() {
  try {
    if (recording.isStarting.value || recording.state.value?.status === 'Stopping') return
    if (recording.isLive.value) {
      if (!isCurrentUserHost.value && !isCurrentUserCohost.value) return
      recordingStopDialogOpen.value = true
      return
    }
    recordingDialogOpen.value = true
  } catch (error) {
    toast.error(refusalOr(error, __('Could not manage capture')))
  }
}
async function confirmRecordingStop() {
  try {
    await recording.stop()
    recordingStopDialogOpen.value = false
  } catch (error) {
    toast.error(refusalOr(error, __('Could not stop capture')))
  }
}
const previewDetails = useQuery(api.meet.rooms.preview, () => ({ meeting_id: meetingId.value }))
const givenTitle = computed(() => previewDetails.data?.title || '')
const meetingTitle = computed(() => givenTitle.value || meetingId.value)
usePageMeta(() => appPageMeta(meetingTitle.value, 'Meet'))

// --- Lobby notification conversion ---
const lobbyUsersForNotifications = computed(() => {
  return lobbyStore.lobbyUsers
    .filter((user) => !notifiedLobbyUsers.value.has(user.userId))
    .map((user) => ({
      user_id: user.userId,
      user_name: user.name,
      user_image: user.avatar,
    }))
})
const e2eeJoinPendingMessage = ref('')
const e2eeJoinStatus = ref<'pending' | 'failed' | ''>('')
const e2eeJoinReason = ref('')
const e2eeState = useE2EEState()
const e2eeJoinTitle = computed(() => {
  if (e2eeJoinStatus.value === 'failed') return __('Could not join encrypted meeting')
  if (e2eeJoinReason.value === 'waiting-for-host') {
    return __('Waiting for the host to join')
  }
  return __('Joining encrypted meeting')
})
interface E2EEJoinDetail {
  status?: string
  reason?: string
  message?: string
}
interface E2EERepublishDetail {
  needsCamera?: boolean
  needsMicrophone?: boolean
}
function handleE2EEJoinStatus(event: Event): void {
  if (!(event instanceof CustomEvent)) return
  const payload: unknown = event.detail
  const detail: E2EEJoinDetail = {}
  if (payload && typeof payload === 'object') {
    if ('status' in payload && typeof payload.status === 'string') detail.status = payload.status
    if ('reason' in payload && typeof payload.reason === 'string') detail.reason = payload.reason
    if ('message' in payload && typeof payload.message === 'string')
      detail.message = payload.message
  }
  if (detail?.status === 'pending') {
    e2eeJoinStatus.value = 'pending'
    e2eeJoinReason.value = detail.reason || ''
    e2eeJoinPendingMessage.value = getE2EEJoinPendingMessage(detail)
    return
  }
  if (detail?.status === 'failed') {
    e2eeJoinStatus.value = 'failed'
    e2eeJoinReason.value = detail.reason || ''
    e2eeJoinPendingMessage.value =
      detail.message ||
      __('Could not set up encryption for this meeting. Please leave and try again.')
    return
  }
  e2eeJoinStatus.value = ''
  e2eeJoinReason.value = ''
  e2eeJoinPendingMessage.value = ''
}
function getE2EEJoinPendingMessage(detail: { reason?: string; message?: string }): string {
  if (detail.reason === 'waiting-for-host') {
    return __("You'll join automatically when the host arrives.")
  }
  return detail.message || __('Waiting for someone already in the encrypted meeting to let you in.')
}

// --- Guest session ---
const isGuestSession = computed(
  () =>
    !session.isLoggedIn &&
    (!!connectionState.guestAuthToken ||
      lobbyStore.isWaitingForApproval ||
      currentUser.currentUser.value?.is_guest === true),
)

// --- SFU Connection ---
const sfuConnection = useSFUConnection({
  connectionState,
  currentUser,
  mediaState,
  participantStore,
  lobbyStore,
  gridLayout,
  meetingId: meetingId.value,
  notifiedLobbyUsers,
  onHostMutedYou: () => {
    if (mediaState.isMicOn) {
      mediaControls.toggleMicrophone()
    }
  },
  onHostKickedYou: () => sfuConnection.endCall(),
  onParticipantConnectionReplaced: () => mediaControls.cleanupLocalMedia(),
  onScreenShareStarted: (data: SFUScreenShareData) => {
    const pid = data.participantId
    const producerId = data.producerId ?? data.consumer?.producerId
    if (!pid || !producerId) return
    const replacement = replaceActiveScreenShare(mediaState.activeScreenShareConsumers || [], {
      source: 'remote',
      participantId: pid,
      consumerId: data.consumer?.id || 'remote-screen',
      producerId,
      startedAt: data.startedAt || Date.now(),
    })
    for (const share of replacement.replaced) {
      sfuConnection.removeScreenSharePreview(share.consumerId)
    }
    mediaState.activeScreenShareConsumers = replacement.shares
    if (data.stream instanceof MediaStream) {
      try {
        const store = mediaState.screenShareStreams || {}
        store[pid] = data.stream
        mediaState.screenShareStreams = store
        void sfuConnection
          .attachScreenSharePreview(data.consumer?.id || 'remote-screen', data.stream, 'owned')
          .catch((error) => console.warn('Failed to attach screen share preview:', error))
      } catch (err) {
        console.warn('Failed to store screen share stream:', err)
      }
    }
  },
  onScreenShareStopped: (data: SFUScreenShareData) => {
    const pid = data.participantId
    const producerId = data.producerId ?? data.consumer?.producerId
    if (!pid || !producerId) return
    const list = mediaState.activeScreenShareConsumers || []
    const current = findActiveScreenShare(
      list,
      pid,
      producerId,
      data.consumerId ?? data.consumer?.id,
    )
    if (!current) return
    sfuConnection.removeScreenSharePreview(current.consumerId)
    mediaState.activeScreenShareConsumers = list.filter((share) => share.producerId !== producerId)
    const store = mediaState.screenShareStreams || {}
    if (pid && store[pid]) {
      delete store[pid]
      mediaState.screenShareStreams = store
    }
  },
  onRoomRejoined: () => void captions.restoreCaptionSubscription(),
  onE2EERequired: () => captions.disableCaptionsForE2EE(),
  onRecordingState: recording.syncState,
  beginRecordingAdmissionSync: recording.beginAdmissionSync,
  onTranscriptionCaptureState: recording.syncTranscriptionCapture,
  onRecordingEnabled: recording.setGlobalEnabled,
  onRole: (isHost, isCohost) => {
    isCurrentUserHost.value = isHost
    isCurrentUserCohost.value = isCohost
    if (!previewDetails.data?.title) void previewDetails.refetch().catch(() => {})
  },
  onCohostPromoted: () => {
    isCurrentUserCohost.value = true
  },
})

// --- Background effects & noise cancellation ---
const backgroundEffects = useBackgroundEffects({
  autoCleanupOnUnmount: false,
  mediaAttachments: sfuConnection,
})
const noiseCancellation = useNoiseCancellation()
const { health: networkHealth, networkQuality } = useNetworkQuality(sfuConnection.sfuManager)
const localNetworkQuality = computed(() => {
  if (
    networkHealth.value.networkQuality === 'critical' ||
    networkHealth.value.downlinkQuality === 'critical'
  )
    return 'critical'
  if (
    networkHealth.value.networkQuality === 'poor' ||
    networkHealth.value.downlinkQuality === 'poor'
  )
    return 'poor'
  return networkHealth.value.status === 'good' ? 'good' : 'unknown'
})

// --- Media Controls ---
const mediaControls = useMediaControls({
  mediaState,
  connectionState,
  raiseHandStore,
  currentUser,
  sfuClient: sfuConnection.sfuClient,
  sfuManager: sfuConnection.sfuManager,
  mediaAttachments: sfuConnection,
  deviceManager,
  backgroundEffects,
  noiseCancellation,
})
meetingControls.toggleMicrophone = () => mediaControls.toggleMicrophone()
meetingControls.toggleCamera = () => mediaControls.toggleCamera()
watch(
  () => mediaState.isMicOn,
  (val) => (meetingControls.isMicOn = val),
  {
    immediate: true,
  },
)

// --- Chat ---
const chat = useChat({
  chatStore,
  currentUser,
  sfuClient: sfuConnection.sfuClient,
  canPin: () => isCurrentUserHost.value || isCurrentUserCohost.value,
})
function unpinChatMessage() {
  const messageId = chatStore.pinnedMessage?.messageId
  if (messageId) chat.pinMessage(messageId, 'unpin')
}

// --- Poll ---

const poll = usePoll({
  pollStore,
  currentUser,
  sfuClient: sfuConnection.sfuClient,
})

// --- Reactions ---
const reactions = useReactions({
  reactionStore,
  currentUser,
  sfuClient: sfuConnection.sfuClient,
})

// --- Raise Hand ---
const raiseHand = useRaiseHand({
  raiseHandStore,
  currentUser,
  sfuClient: sfuConnection.sfuClient,
})
const captions = useCaptions({
  sfuClient: sfuConnection.sfuClient,
})
const {
  isAvailable: areCaptionsAvailable,
  isCaptionsEnabled,
  captionLines,
  toggleCaptions,
} = captions

// --- Lobby ---
const lobby = useLobby({
  lobbyStore,
  meetingId,
})
// --- Provide meeting context for child components ---
provideMeetingContext({
  mediaState,
  participantStore,
  currentUser,
  chatStore,
  gridLayout,
  raiseHandStore,
  reactionStore,
  lobbyStore,
  sfuManager: sfuConnection.sfuManager.value,
  processedStream: toRef(mediaState, 'processedStream'),
  isInMeeting: computed(() => true),
  onBackgroundEffectsChanged: mediaControls.applyBackgroundEffectsToLocalStream,
  networkQuality,
  localNetworkQuality,
  networkHealth,
})

// Provide legacy injects for components not yet migrated to useMeetingContext
provide('setLocalVideoRef', mediaControls.setLocalVideoRef)
provide('setRemoteVideoRef', mediaControls.setRemoteVideoRef)
provide('setScreenShareVideoRef', (_consumerId: string, element: HTMLVideoElement | null) => {
  mediaControls.setScreenShareVideoRef(_consumerId, element)
})
provide('getParticipantName', participantStore.getParticipantName)
provide('meetingId', meetingId.value)
provide('sfuManager', sfuConnection.sfuManager)
provide('socket', useSocket())
provide('isCurrentUserHost', isCurrentUserHost)
provide('isCurrentUserCohost', isCurrentUserCohost)
provide('hostControls', {
  muteParticipant: (...args: unknown[]) =>
    handleMuteParticipant(typeof args[0] === 'string' ? args[0] : ''),
  kickParticipant: (...args: unknown[]) =>
    handleKickParticipant(typeof args[0] === 'string' ? args[0] : '', args[1] === true),
})
provide(
  'meetingTitle',
  computed(() => meetingTitle.value),
)
provide(pollKey, poll)

// --- Computed properties ---
const isConnecting = sfuConnection.isConnecting
const hasConnectionError = computed(() => !!connectionState.connectionError)
// The screen gives a plain title; the reason, which can be setup detail, goes to the console.
watch(
  () => connectionState.connectionError,
  (reason) => {
    if (reason) console.error('Could not join the meeting:', reason)
  },
)
const isInLobby = computed(() => lobbyStore.isInLobby || false)
const isWaitingForApproval = computed(() => lobbyStore.isWaitingForApproval || false)
const isRejected = computed(() => lobbyStore.isJoinRequestRejected || false)
const showPreview = computed(() => {
  if (isPreparingAutoJoin.value) return false
  const isUnauthenticatedGuest = !session.isLoggedIn && !isGuestSession.value
  if (isUnauthenticatedGuest) {
    return true
  }
  if (lobbyStore.isInLobby) {
    return false
  }
  if (lobbyStore.isWaitingForApproval) {
    return false
  }
  const inPreview = connectionState.isInPreview
  const joinRequestRejected = lobbyStore.isJoinRequestRejected
  return inPreview || joinRequestRejected
})

// During the call, toasts rise above the toolbar instead of covering its buttons (People, Chat,
// Meeting information). The class lives on <html> because the toaster is mounted outside this page.
const isInCall = computed(
  () => !showPreview.value && !connectionState.connectionMoved && !hasConnectionError.value,
)
watchEffect(() => document.documentElement.classList.toggle('meet-in-call', isInCall.value))
onUnmounted(() => document.documentElement.classList.remove('meet-in-call'))
const canLeaveMeeting = ref(false)
let pendingLeaveConfirmation: Promise<boolean> | null = null
async function confirmMeetingLeave() {
  if (
    canLeaveMeeting.value ||
    (!sfuConnection.isSetupComplete.value && !sfuConnection.isConnecting.value)
  )
    return true
  if (pendingLeaveConfirmation) return pendingLeaveConfirmation
  pendingLeaveConfirmation = confirmLeave({
    title: __('Leave meeting?'),
    message: __('You will be disconnected from the meeting.'),
    confirmLabel: __('Leave meeting'),
    focusConfirm: true,
  })
  try {
    return await pendingLeaveConfirmation
  } finally {
    pendingLeaveConfirmation = null
  }
}
async function confirmAndEndCall() {
  if (!(await confirmMeetingLeave())) return
  canLeaveMeeting.value = true
  const leftMeetingId = meetingId.value
  const canRejoin = session.isLoggedIn
  await sfuConnection.endCall()
  // Back on Meet home, say the call ended for you and offer the way back; toasts from the call
  // (such as "Meeting created") no longer apply.
  toast.dismiss()
  if (!canRejoin) return
  toast.success(__('You left the meeting'), {
    duration: 8000,
    action: {
      label: __('Rejoin'),
      onClick: () =>
        void router.push({ name: 'meet-meeting', params: { meetingId: leftMeetingId } }),
    },
  })
}
onBeforeRouteLeave(confirmMeetingLeave)
onBeforeRouteUpdate((to, from) => {
  if (to.params.meetingId === from.params.meetingId) return true
  return confirmMeetingLeave()
})

// Soft connecting feedback: only if join takes longer than 5s (no full-page spinner).
const CONNECTING_TOAST_ID = 'meet-connecting'
const CONNECTING_TOAST_DELAY_MS = 5000
let connectingToastTimer: ReturnType<typeof setTimeout> | null = null
const clearConnectingToast = () => {
  if (connectingToastTimer) {
    clearTimeout(connectingToastTimer)
    connectingToastTimer = null
  }
  toast.dismiss(CONNECTING_TOAST_ID)
}
watch(
  [
    isConnecting,
    showPreview,
    isWaitingForApproval,
    isInLobby,
    hasConnectionError,
    e2eeJoinPendingMessage,
  ],
  ([connecting, preview, waiting, lobby, error, e2eePending]) => {
    const shouldTrack = connecting && !preview && !waiting && !lobby && !error && !e2eePending
    if (!shouldTrack) {
      clearConnectingToast()
      return
    }
    if (connectingToastTimer) {
      return
    }
    connectingToastTimer = setTimeout(() => {
      connectingToastTimer = null
      if (
        !sfuConnection.isConnecting.value ||
        connectionState.isInPreview ||
        lobbyStore.isWaitingForApproval ||
        lobbyStore.isInLobby ||
        connectionState.connectionError ||
        e2eeJoinPendingMessage.value
      ) {
        return
      }
      toast.loading(__('Connecting…'), {
        id: CONNECTING_TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
      })
    }, CONNECTING_TOAST_DELAY_MS)
  },
)
const isPeopleOpen = ref(false)
const activePanel = computed(() => {
  if (chatStore.isChatOpen) return 'chat'
  if (isPeopleOpen.value) return 'people'
  return null
})
const moderationRoom = useQuery(api.meet.rooms.get, () =>
  activePanel.value === 'people' && (isCurrentUserHost.value || isCurrentUserCohost.value)
    ? { name: meetingId.value }
    : false,
)
const meetingOwner = computed(() => moderationRoom.data?.owner || '')
const meetingCoHosts = computed(() => moderationRoom.data?.co_hosts?.map((row) => row.user) || [])
const participantsForPeoplePanel = computed<Record<string, Participant>>(
  () => participantStore.participants,
)
const participantAvatars = computed(() =>
  Object.fromEntries(
    Object.entries(participantsForPeoplePanel.value).map(([userId, participant]) => [
      userId,
      participant.avatar,
    ]),
  ),
)
const participantNames = computed(() =>
  Object.fromEntries(
    Object.entries(participantsForPeoplePanel.value).map(([userId, participant]) => [
      userId,
      participant.user_name,
    ]),
  ),
)

const { isMobile } = useResponsiveGrid()
const panelWidth = computed(() => {
  if (!activePanel.value) return '0rem'
  if (isMobile.value) return '0rem'
  return '24rem'
})
const isHandRaised = computed(() => {
  const currentUserId = currentUser.currentUser.value?.user_id ?? ''
  return currentUserId ? !!raiseHandStore.raisedHands?.[currentUserId] : false
})

// --- Refs ---
const isInitializingPreview = ref(true)
const isReactionPickerOpen = ref(false)
const isFullscreen = ref(false)
const isToolbarVisible = ref(true)
const headerVisible = computed(
  () => showPreview.value || isConnecting.value || !autoHideToolbar.value || isToolbarVisible.value,
)

// --- Extracted handlers ---
const handlers = useMeetingHandlers({
  connectionState,
  mediaState,
  participantStore,
  chatStore,
  lobbyStore,
  reactionStore,
  raiseHandStore,
  gridLayout,
  currentUser,
  sfuConnection,
  mediaControls,
  lobby,
  meetingId: meetingId.value,
  isCurrentUserHost,
  isPeopleOpen,
  notifiedLobbyUsers,
  router,
})
const {
  resetToPreview,
  joinMeetingFromPreview,
  handleGuestJoinComplete,
  leaveWaitingRoom,
  leaveLobby,
  goHome,
  tryJoinAgain,
  toggleChat,
  handleMuteParticipant,
  handleKickParticipant,
  handleLowerHand,
  handlePromoteToCohost,
  handleApproveLobbyUser,
  handleApproveAllLobbyUsers,
  handleRejectLobbyUser,
  toggleFullscreen,
  handleReportProblem,
  handleDeviceChanged,
} = handlers
const showMeetingNotification = (notification: {
  message: string
  fromUser: string
  fromName: string
  type: 'chat' | 'poll'
}) => {
  const participant = participantStore.participants[notification.fromUser]
  const openChat = () => {
    if (!chatStore.isChatOpen) toggleChat()
  }
  let toastId: string | number
  const removeToastId = () => meetingNotificationIds.delete(toastId)
  const handleClick = () => {
    toast.dismiss(toastId)
    openChat()
  }
  toastId = toast.custom(
    () =>
      h(
        'button',
        {
          type: 'button',
          class: 'flex w-full min-w-0 items-center gap-3 text-left focus-visible:outline-none',
          onClick: handleClick,
        },
        [
          h(MeetAvatar, {
            image: participant?.avatar,
            label: notification.fromName,
            size: 'lg',
          }),
          h(
            'span',
            {
              class: 'min-w-0 flex-1',
            },
            [
              h(
                'span',
                {
                  class: 'block truncate text-p-base font-medium text-ink-base',
                },
                notification.type === 'poll'
                  ? __('{0} started a poll', [notification.fromName])
                  : notification.fromName,
              ),
              h(
                'span',
                {
                  class: 'block truncate text-p-base text-ink-base',
                },
                notification.message,
              ),
            ],
          ),
        ],
      ),
    {
      duration: 5000,
      onDismiss: removeToastId,
      onAutoClose: removeToastId,
    },
  )
  meetingNotificationIds.add(toastId)
}
const meetingNotificationIds = new Set<string | number>()
const clearMeetingNotifications = () => {
  for (const id of meetingNotificationIds) toast.dismiss(id)
  meetingNotificationIds.clear()
}
watch(
  () => chatStore.isChatOpen,
  (isOpen) => {
    if (isOpen) clearMeetingNotifications()
  },
)

// --- Local UI state ---
const togglePeople = () => {
  isPeopleOpen.value = !isPeopleOpen.value
  if (isPeopleOpen.value) {
    chatStore.isChatOpen = false
    if (isCurrentUserHost.value || isCurrentUserCohost.value) {
      void sfuConnection.fetchExistingWaitingRoomUsers()
    }
  }
}
const toggleReactions = (payload: string) => {
  reactions.onSendReaction(payload)
  isReactionPickerOpen.value = false
}
const toggleStatsForNerds = () => {
  setShowStatsForNerds(!showStatsForNerds.value)
}
const syncFullscreenState = () => {
  isFullscreen.value = !!document.fullscreenElement
}
const handleE2EENeedsMediaRepublish = async (event: Event) => {
  if (!(event instanceof CustomEvent)) return
  const payload: unknown = event.detail
  const detail: E2EERepublishDetail = {}
  if (payload && typeof payload === 'object') {
    if ('needsCamera' in payload && typeof payload.needsCamera === 'boolean')
      detail.needsCamera = payload.needsCamera
    if ('needsMicrophone' in payload && typeof payload.needsMicrophone === 'boolean')
      detail.needsMicrophone = payload.needsMicrophone
  }
  try {
    await mediaControls.republishMediaAfterE2EE(detail)
  } catch (error) {
    console.error('Failed to republish media after E2EE reconfiguration:', error)
  }
}

// --- Lifecycle ---
let disposeChatEvents: (() => void) | undefined

onMounted(async () => {
  // Reset all stores
  connectionState.$reset()
  mediaState.$reset()
  participantStore.$reset()
  chatStore.$reset()
  pollStore.$reset()
  lobbyStore.$reset()
  reactionStore.$reset()
  raiseHandStore.$reset()
  captions.reset()
  gridLayout.resetGridLayout()
  currentUser.resetCurrentUser()
  e2eeState.reset()
  document.addEventListener('fullscreenchange', syncFullscreenState)
  document.addEventListener('meet:e2ee-needs-media-republish', handleE2EENeedsMediaRepublish)
  document.addEventListener('meet:e2ee-join-status', handleE2EEJoinStatus)
  syncFullscreenState()
  disposeChatEvents = chat.setupChatEvents(showMeetingNotification)

  // Check meeting access for unauthenticated users
  if (!session.isLoggedIn) {
    try {
      const accessData = await client.query(api.meet.rooms.access, {
        meeting_id: meetingId.value,
      })
      if (accessData?.host_only_chat !== undefined) {
        chatStore.hostOnlyChat = !!accessData.host_only_chat
      }
      if (!accessData?.allow_guest) {
        const loginUrl = `/login?redirect-to=${encodeURIComponent(`/meet/${meetingId.value}`)}`
        window.location.href = loginUrl
        return
      }
    } catch (error) {
      console.error('Failed to check meeting access:', error)
      isInitializingPreview.value = false
      return
    }
  }

  // Setup event handlers
  reactions.setupReactionEvents()
  raiseHand.setupRaiseHandEvents()
  poll.setupPollEvents(showMeetingNotification)

  // Setup notification context watchers

  if (!session.isLoggedIn) {
    await mediaControls.initializeCamera()
    if (selectedSpeakerId.value) {
      await mediaControls.applySpeakerDevice()
    }
    isInitializingPreview.value = false
    return
  }
  if (!userResource.fetched) {
    try {
      await userResource.fetch()
    } catch (error) {
      console.warn('Failed to load current user profile:', error)
    }
  }

  // Initialize camera
  await mediaControls.initializeCamera()
  if (selectedSpeakerId.value) {
    await mediaControls.applySpeakerDevice()
  }
  isInitializingPreview.value = false

  if (isPreparingAutoJoin.value) {
    const joining = joinMeetingFromPreview()
    isPreparingAutoJoin.value = false
    await joining
  }
})
onUnmounted(() => {
  disposeChatEvents?.()
  isPreparingAutoJoin.value = false
  clearConnectingToast()
  clearMeetingNotifications()
  document.removeEventListener('fullscreenchange', syncFullscreenState)
  document.removeEventListener('meet:e2ee-needs-media-republish', handleE2EENeedsMediaRepublish)
  document.removeEventListener('meet:e2ee-join-status', handleE2EEJoinStatus)
})
watch(selectedSpeakerId, async (newSpeakerId) => {
  if (newSpeakerId && deviceManager.isDeviceAvailable(newSpeakerId, 'speaker')) {
    await mediaControls.applySpeakerDevice()
  }
})

// Watch lobby users for notification tracking
watch(
  () => lobbyStore.lobbyUsers,
  (newUsers, oldUsers) => {
    if (isCurrentUserHost.value) {
      const newUserIds = new Set((newUsers || []).map((u) => u.userId))
      const oldUserIds = new Set((oldUsers || []).map((u) => u.userId))
      for (const userId of oldUserIds) {
        if (!newUserIds.has(userId)) {
          notifiedLobbyUsers.value.add(userId)
        }
      }
    }
  },
  {
    immediate: true,
  },
)
watch(
  () => chatStore.hostOnlyChat,
  (isRestricted, oldValue) => {
    if (
      isRestricted !== oldValue &&
      (isCurrentUserHost.value || isCurrentUserCohost.value) &&
      sfuConnection.sfuClient?.isConnected()
    ) {
      chat.toggleRestriction(isRestricted)
    }
  },
)
let previousTheme: string | null = null
let previousThemeMode: string | null = null
let previousBodyTheme: string | null = null
let previousBodyThemeMode: string | null = null
let themeObserver: MutationObserver | null = null
let userChangedTheme = false
const forceDarkTheme = () => {
  if (document.documentElement.getAttribute('data-theme') !== 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  }
  if (document.body.getAttribute('data-theme') !== 'dark') {
    document.body.setAttribute('data-theme', 'dark')
  }
}
onMounted(() => {
  previousTheme = document.documentElement.getAttribute('data-theme')
  previousThemeMode = document.documentElement.getAttribute('data-theme-mode')
  previousBodyTheme = document.body.getAttribute('data-theme')
  previousBodyThemeMode = document.body.getAttribute('data-theme-mode')
  forceDarkTheme()
  document.documentElement.setAttribute('data-theme-mode', 'dark')
  document.body.setAttribute('data-theme-mode', 'dark')
  themeObserver = new MutationObserver(forceDarkTheme)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  const modeObserver = new MutationObserver(() => {
    userChangedTheme = true
  })
  modeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme-mode'],
  })
})
onUnmounted(() => {
  themeObserver?.disconnect()
  themeObserver = null
  if (userChangedTheme) {
    const mode = document.documentElement.getAttribute('data-theme-mode') || 'light'
    const resolved =
      mode === 'automatic'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : mode
    document.documentElement.setAttribute('data-theme', resolved)
    document.documentElement.setAttribute('data-theme-mode', mode)
    document.body.setAttribute('data-theme', resolved)
    document.body.setAttribute('data-theme-mode', mode)
  } else {
    if (previousTheme) {
      document.documentElement.setAttribute('data-theme', previousTheme)
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
    if (previousThemeMode) {
      document.documentElement.setAttribute('data-theme-mode', previousThemeMode)
    } else {
      document.documentElement.removeAttribute('data-theme-mode')
    }
    if (previousBodyTheme) {
      document.body.setAttribute('data-theme', previousBodyTheme)
    } else {
      document.body.removeAttribute('data-theme')
    }
    if (previousBodyThemeMode) {
      document.body.setAttribute('data-theme-mode', previousBodyThemeMode)
    } else {
      document.body.removeAttribute('data-theme-mode')
    }
  }
})
</script>

<style>
html.meet-in-call [data-sonner-toaster][data-y-position='bottom'] {
  bottom: calc(var(--offset-bottom) + 3.75rem) !important;
}
@media (max-width: 600px) {
  html.meet-in-call [data-sonner-toaster][data-y-position='bottom'] {
    bottom: calc(
      var(--mobile-offset-bottom) + 3.75rem + max(env(safe-area-inset-bottom), 0px)
    ) !important;
  }
}
</style>
