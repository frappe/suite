<template>
  <Teleport v-if="pipWindow" :to="pipWindow.document.body">
    <section
      data-theme="dark"
      class="flex h-screen flex-col gap-2 overflow-hidden bg-surface-base p-2 text-ink-gray-9"
    >
      <div class="flex min-h-0 flex-1 flex-col gap-1">
        <div class="flex min-h-0 flex-1 gap-1" :class="{ 'flex-col': !presentation }">
          <div
            class="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-4 bg-surface-gray-2"
          >
            <video
              v-show="videoAvailable"
              :ref="setDocumentVideo"
              :class="{ '-scale-x-100': primaryIsLocal }"
              autoplay
              playsinline
              muted
              class="h-full w-full object-cover"
            />
            <MeetAvatar
              v-if="!videoAvailable && primaryAvatarLabel"
              :image="primaryAvatar"
              :label="primaryAvatarLabel"
              size="2xl"
            />
            <MeetCameraOffIcon v-else-if="!videoAvailable" class="size-10 text-ink-gray-5" />
            <NamePill :name="participantName || __('Meeting')" role="status">
              <MicOff
                v-if="!micOn"
                class="size-3 shrink-0 -scale-x-100"
                :aria-label="__('Muted')"
              />
              <AudioIndicator
                v-else-if="selfAudio"
                :media-stream="selfAudio"
                :is-active="true"
                :max-height="12"
                :sensitivity="3.0"
                active-color-class="bg-white"
              />
            </NamePill>
          </div>
          <div
            v-if="secondName"
            class="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-4 bg-surface-gray-2"
          >
            <video
              v-if="secondStream"
              :srcObject.prop="secondStream"
              autoplay
              playsinline
              muted
              class="h-full w-full object-cover"
            />
            <MeetAvatar v-else :image="secondAvatar" :label="secondAvatarLabel" size="2xl" />
            <NamePill :name="secondName" role="status">
              <MicOff
                v-if="remoteMuted"
                class="size-3 shrink-0 -scale-x-100"
                :aria-label="__('Muted')"
              />
              <AudioIndicator
                v-else-if="remoteAudio"
                :media-stream="remoteAudio"
                :is-active="true"
                :max-height="12"
                :sensitivity="3.0"
                active-color-class="bg-white"
              />
            </NamePill>
          </div>
        </div>
        <div
          v-if="presentation"
          class="relative flex min-h-0 flex-[2] items-center justify-center overflow-hidden rounded-4 bg-surface-gray-2"
        >
          <video
            :srcObject.prop="presentation.stream"
            autoplay
            playsinline
            muted
            class="h-full w-full object-contain"
            :class="{ 'blur-md': presentation.local }"
          />
          <LocalScreenShareCover v-if="presentation.local" show-copy video-already-blurred />
          <NamePill :name="presentation.label" role="status" />
        </div>
      </div>
      <div
        class="flex shrink-0 items-center justify-center gap-1.5"
        role="toolbar"
        :aria-label="__('Meeting controls')"
      >
        <ToolbarButton
          :title="micOn ? __('Mute') : __('Unmute')"
          :variant="micOn ? 'default' : 'muted'"
          :aria-pressed="!micOn"
          :show-tooltip="false"
          @click="emit('toggle-microphone')"
        >
          <MeetMicIcon v-if="micOn" />
          <MeetMicOffIcon v-else class="size-5 -scale-x-100" />
        </ToolbarButton>
        <ToolbarButton
          :title="cameraOn ? __('Turn camera off') : __('Turn camera on')"
          :variant="cameraOn ? 'default' : 'muted'"
          :aria-pressed="!cameraOn"
          :show-tooltip="false"
          @click="emit('toggle-camera')"
        >
          <MeetCameraIcon v-if="cameraOn" />
          <MeetCameraOffIcon v-else />
        </ToolbarButton>
        <ToolbarButton
          :title="__('Leave meeting')"
          variant="active"
          :show-tooltip="false"
          @click="leaveMeeting"
        >
          <MeetPhoneOffIcon class="size-5 text-ink-red-6" />
        </ToolbarButton>
      </div>
    </section>
  </Teleport>
  <video
    ref="fallbackVideo"
    autoplay
    playsinline
    muted
    class="pointer-events-none fixed bottom-0 left-0 h-px w-px opacity-0"
    aria-hidden="true"
  />
  <p
    v-if="error"
    class="fixed bottom-24 left-4 z-50 rounded-4 bg-surface-elevation-2 p-3 text-ink-gray-9"
    role="status"
  >
    {{ error }}
  </p>
</template>

<script setup lang="ts">
import { MicOff } from 'lucide-vue-next'
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'

import { translate as __ } from '@/platform/translation'

import { useMeetingContext } from '../composables/useMeetingContext'
import { automaticPictureInPicture } from '../data/mediaPreferences'
import MeetCameraIcon from '../icons/MeetCameraIcon.vue'
import MeetCameraOffIcon from '../icons/MeetCameraOffIcon.vue'
import MeetMicIcon from '../icons/MeetMicIcon.vue'
import MeetMicOffIcon from '../icons/MeetMicOffIcon.vue'
import MeetPhoneOffIcon from '../icons/MeetPhoneOffIcon.vue'
import { isFirefoxDesktop } from '../utils/device'
import type { SFUMeetingManager } from '../utils/SFUMeetingManager'
import AudioIndicator from './AudioIndicator.vue'
import LocalScreenShareCover from './LocalScreenShareCover.vue'
import MeetAvatar from './MeetAvatar.vue'
import NamePill from './NamePill.vue'
import ToolbarButton from './ToolbarButton.vue'

type PipVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean
  webkitSetPresentationMode?: (mode: string) => void
  webkitPresentationMode?: string
}
type DocumentPip = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>
}
const props = defineProps<{
  active: boolean
  micOn: boolean
  cameraOn: boolean
}>()
const emit = defineEmits<{
  'toggle-microphone': []
  'toggle-camera': []
  leave: []
}>()
const context = useMeetingContext()!
const manager = inject<Ref<SFUMeetingManager | null>>('sfuManager')
// SAFETY: Document PiP is a browser extension to Window; the API is optional.
const documentPip = (window as Window & { documentPictureInPicture?: DocumentPip })
  .documentPictureInPicture
const pipWindow = shallowRef<Window | null>(null)
const fallbackVideo = ref<PipVideo | null>(null)
const documentVideo = shallowRef<HTMLVideoElement | null>(null)
const videoAvailable = ref(false)
const primaryIsLocal = ref(false)
const primaryAvatar = ref<string | null>()
const primaryAvatarLabel = ref('')
const secondAvatar = ref<string | null>()
const secondAvatarLabel = ref('')
const secondName = ref('')
const presentation = shallowRef<{ stream: MediaStream; label: string; local: boolean } | null>(null)
const visibleRemoteId = ref<string | null>(null)
const selfAudio = shallowRef<MediaStream | null>(null)
const remoteAudio = shallowRef<MediaStream | null>(null)
function updateAudioStream(target: typeof selfAudio, track: MediaStreamTrack | null | undefined) {
  const liveTrack = track?.readyState === 'live' ? track : null
  if ((target.value?.getAudioTracks()[0] ?? null) !== liveTrack) {
    target.value = liveTrack ? new MediaStream([liveTrack]) : null
  }
}
const remoteMuted = computed(
  () =>
    !!visibleRemoteId.value &&
    context.participantStore.participants[visibleRemoteId.value]?.audio_enabled === false,
)
const secondStream = shallowRef<MediaStream | null>(null)
const participantName = ref('')
const error = ref('')
let selectedTrack: MediaStreamTrack | null = null
let stream: MediaStream | null = null
let selectedParticipant: string | null = null
let fallbackActive = false
let pending = false
let disposed = false
let generation = 0
let timer: ReturnType<typeof setInterval> | undefined
let errorTimer: ReturnType<typeof setTimeout> | undefined
let actionRegistered = false
let demandManager: SFUMeetingManager | null = null
const supported = computed(
  () =>
    props.active &&
    (!!documentPip ||
      (videoAvailable.value &&
        ((document.pictureInPictureEnabled &&
          typeof fallbackVideo.value?.requestPictureInPicture === 'function') ||
          fallbackVideo.value?.webkitSupportsPresentationMode?.('picture-in-picture') === true))),
)
function setDocumentVideo(el: unknown) {
  // SAFETY: Vue calls this ref with the teleported video node or null, including across windows.
  documentVideo.value = el as HTMLVideoElement | null
  if (documentVideo.value) documentVideo.value.srcObject = stream
}
// The shared stage supplies active speaker IDs, but no per-turn timestamps.
const speakerStartedAt = new Map<string, number>()
watch(
  () => [...context.participantStore.activeSpeakerIds],
  (ids) => {
    const active = new Set(ids)
    for (const id of speakerStartedAt.keys()) {
      if (!active.has(id)) speakerStartedAt.delete(id)
    }
    const now = Date.now()
    for (const id of active) {
      if (!speakerStartedAt.has(id)) speakerStartedAt.set(id, now)
    }
  },
  { immediate: true, flush: 'sync' },
)

function refresh() {
  if (disposed || !props.active || !automaticPictureInPicture.value) return
  const participants = context.participantStore.participants
  const self = context.currentUser?.currentUser.value
  const ids = [
    ...new Set([...context.participantStore.activeSpeakerIds, ...Object.keys(participants)]),
  ].filter((id) => participants[id] && id !== self?.user_id)
  let remoteTrack: MediaStreamTrack | null = null
  let remoteId: string | null = null
  for (const candidate of ids) {
    if (!participants[candidate]?.video_enabled) continue
    const camera = manager?.value?.getRemoteVideoTrack(candidate)
    if (camera?.readyState !== 'live') continue
    remoteTrack = camera
    remoteId = candidate
    break
  }
  const localStream = context.mediaState.processedStream ?? context.mediaState.localStream
  const localTrack = context.mediaState.isCameraOn
    ? (localStream?.getVideoTracks().find((track) => track.readyState === 'live') ?? null)
    : null
  const documentMode = !!pipWindow.value
  const track = documentMode ? localTrack : (remoteTrack ?? localTrack)
  const pins = context.gridLayout?.pinnedTiles.value ?? []
  const pinnedParticipant = pins.find((pin) => pin.type === 'participant' && ids.includes(pin.id))
  const now = Date.now()
  const stableSpeaker = context.participantStore.activeSpeakerIds.find((id) => {
    const startedAt = speakerStartedAt.get(id)
    return ids.includes(id) && startedAt !== undefined && now - startedAt >= 1000
  })
  const currentRemote = visibleRemoteId.value
  const nextRemote =
    pinnedParticipant?.id ??
    stableSpeaker ??
    (currentRemote && ids.includes(currentRemote) ? currentRemote : (remoteId ?? ids[0]))
  visibleRemoteId.value = documentMode ? (nextRemote ?? null) : null
  const shares = documentMode ? (context.gridLayout?.displayScreenShares.value ?? []) : []
  const pinnedShare = shares.find((share) =>
    pins.some((pin) => pin.type === 'screenshare' && pin.id === share.participantId),
  )
  let presentationTrack: MediaStreamTrack | undefined
  let presentationLabel = ''
  let localPresentation = false
  for (const share of new Set(pinnedShare ? [pinnedShare, ...shares] : shares)) {
    const source =
      share.source === 'local'
        ? context.mediaState.screenShareStream
        : context.mediaState.screenShareStreams[share.participantId]
    presentationTrack = source?.getVideoTracks().find((track) => track.readyState === 'live')
    if (!presentationTrack) continue
    localPresentation = share.source === 'local'
    presentationLabel =
      share.source === 'local'
        ? __('Your screen')
        : __('{0}’s screen', [participants[share.participantId]?.user_name || __('Participant')])
    break
  }
  if (
    presentation.value?.stream.getVideoTracks()[0] !== presentationTrack ||
    presentation.value?.local !== localPresentation ||
    presentation.value?.label !== presentationLabel
  ) {
    presentation.value = presentationTrack
      ? {
          stream: new MediaStream([presentationTrack]),
          local: localPresentation,
          label: presentationLabel,
        }
      : null
  }
  const secondId = visibleRemoteId.value
  updateAudioStream(
    selfAudio,
    documentMode && props.micOn ? context.mediaState.localStream?.getAudioTracks()[0] : null,
  )
  updateAudioStream(
    remoteAudio,
    secondId && !remoteMuted.value ? manager?.value?.getRemoteAudioTrack(secondId) : null,
  )
  const camera =
    secondId && participants[secondId]?.video_enabled
      ? manager?.value?.getRemoteVideoTrack(secondId)
      : null
  const secondTrack = camera?.readyState === 'live' ? camera : null
  const secondary = secondId ? participants[secondId] : undefined
  primaryIsLocal.value = documentMode
  primaryAvatar.value = self?.avatar
  primaryAvatarLabel.value = self?.full_name || self?.name || __('You')
  secondAvatar.value = secondary?.avatar
  secondAvatarLabel.value = secondary?.user_name || __('Participant')
  if (secondStream.value?.getVideoTracks()[0] !== secondTrack) {
    secondStream.value = secondTrack ? new MediaStream([secondTrack]) : null
  }
  secondName.value = secondId ? secondAvatarLabel.value : ''
  selectedParticipant = documentMode ? visibleRemoteId.value : remoteId
  participantName.value = documentMode
    ? __('You')
    : remoteId
      ? participants[remoteId]?.user_name || __('Participant')
      : track
        ? __('You')
        : __('Meeting — cameras off')
  videoAvailable.value = !!track
  if (selectedTrack !== track) {
    selectedTrack = track
    stream = track ? new MediaStream([track]) : null
    for (const video of [fallbackVideo.value, documentVideo.value]) {
      if (video) {
        video.muted = true
        video.srcObject = stream
        void video.play().catch(() => {})
      }
    }
  }
  const activeManager = manager?.value ?? null
  if (demandManager && demandManager !== activeManager)
    demandManager.setPictureInPictureParticipant(null)
  demandManager = activeManager
  demandManager?.setPictureInPictureParticipant(
    documentMode || fallbackActive ? selectedParticipant : null,
  )
}
function release() {
  pipWindow.value = null
  selfAudio.value = null
  remoteAudio.value = null
  secondStream.value = null
  presentation.value = null
  visibleRemoteId.value = null
  fallbackActive = false
  demandManager?.setPictureInPictureParticipant(null)
}
function close() {
  generation++
  error.value = ''
  clearTimeout(errorTimer)
  pipWindow.value?.close()
  const video = fallbackVideo.value
  if (document.pictureInPictureElement === video)
    void document.exitPictureInPicture().catch(() => {})
  if (video?.webkitPresentationMode === 'picture-in-picture')
    video.webkitSetPresentationMode?.('inline')
  release()
  for (const element of [video, documentVideo.value]) if (element) element.srcObject = null
  selectedTrack = null
  stream = null
}
function returnToMeeting() {
  window.focus()
  close()
}
function leaveMeeting() {
  returnToMeeting()
  emit('leave')
}
async function open() {
  if (
    disposed ||
    !automaticPictureInPicture.value ||
    !supported.value ||
    pending ||
    pipWindow.value ||
    fallbackActive
  )
    return
  pending = true
  const requestGeneration = generation
  error.value = ''
  try {
    if (documentPip) {
      const win = await documentPip.requestWindow({ width: 320, height: 400 })
      if (!props.active || requestGeneration !== generation) {
        win.close()
        return
      }
      const base = win.document.createElement('base')
      base.href = document.baseURI
      win.document.head.appendChild(base)
      win.document.body.style.margin = '0'
      for (const sheet of document.querySelectorAll('link[rel="stylesheet"], style'))
        win.document.head.appendChild(sheet.cloneNode(true))
      win.document.title = __('Meet')
      win.addEventListener('pagehide', release, { once: true })
      pipWindow.value = win
    } else {
      const video = fallbackVideo.value
      if (!video || video.readyState < 1) throw new Error('Video is not ready')
      if (document.pictureInPictureEnabled && video.requestPictureInPicture)
        await video.requestPictureInPicture()
      else video.webkitSetPresentationMode?.('picture-in-picture')
      fallbackActive = true
      if (!props.active || requestGeneration !== generation) {
        close()
        return
      }
    }
    refresh()
  } catch {
    if (props.active && requestGeneration === generation) {
      error.value = __(
        'Could not open picture-in-picture. Allow automatic picture-in-picture in your browser settings.',
      )
      clearTimeout(errorTimer)
      errorTimer = setTimeout(() => {
        error.value = ''
      }, 6000)
    }
  } finally {
    pending = false
  }
}
// SAFETY: This browser action is missing from the DOM typings; registration is guarded.
const action = 'enterpictureinpicture' as MediaSessionAction
watch(
  [() => props.active, automaticPictureInPicture],
  ([active, enabled]) => {
    const shouldRegister = active && enabled
    if (!shouldRegister) close()
    if (isFirefoxDesktop() || !navigator.mediaSession) return
    try {
      navigator.mediaSession.setActionHandler(
        action,
        shouldRegister
          ? () => {
              void open()
            }
          : null,
      )
      actionRegistered = shouldRegister
    } catch {
      /* Optional action unsupported by this browser. */
    }
  },
  { immediate: true },
)
function enteredVideoPip() {
  fallbackActive = true
  refresh()
}
function presentationChanged() {
  fallbackActive = fallbackVideo.value?.webkitPresentationMode === 'picture-in-picture'
  refresh()
}
function closeWhenMeetingReturns() {
  if (document.visibilityState === 'visible' && (pipWindow.value || fallbackActive || pending)) {
    close()
  }
}
onMounted(() => {
  window.addEventListener('focus', closeWhenMeetingReturns)
  document.addEventListener('visibilitychange', closeWhenMeetingReturns)
  refresh()
  timer = setInterval(refresh, 500)
  fallbackVideo.value?.addEventListener('enterpictureinpicture', enteredVideoPip)
  fallbackVideo.value?.addEventListener('leavepictureinpicture', release)
  fallbackVideo.value?.addEventListener('webkitpresentationmodechanged', presentationChanged)
  window.addEventListener('pagehide', close)
})
onBeforeUnmount(() => {
  disposed = true
  clearInterval(timer)
  clearTimeout(errorTimer)
  close()
  fallbackVideo.value?.removeEventListener('enterpictureinpicture', enteredVideoPip)
  fallbackVideo.value?.removeEventListener('leavepictureinpicture', release)
  fallbackVideo.value?.removeEventListener('webkitpresentationmodechanged', presentationChanged)
  window.removeEventListener('pagehide', close)
  window.removeEventListener('focus', closeWhenMeetingReturns)
  document.removeEventListener('visibilitychange', closeWhenMeetingReturns)
  if (actionRegistered)
    try {
      navigator.mediaSession.setActionHandler(action, null)
    } catch {
      /* Optional API. */
    }
})
defineExpose({ supported, open, close })
</script>
