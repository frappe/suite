import { toast } from 'frappe-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { api, client, useMutation } from '@/api'
import { randomId } from '@/platform/random-id'
import { translate as __ } from '@/platform/translation'

import type { RecordingStateOutput } from '../client/generated'
import { useSocket } from '../socket'
import {
  captureActivityLabel,
  captureLabel,
  captureNotice,
  defaultCaptureOptions,
  type CaptureOptions,
  type TranscriptionCaptureState,
} from '../utils/capturePresentation'

export type { CaptureOptions } from '../utils/capturePresentation'

export type RecordingState = NonNullable<RecordingStateOutput>

type RecordingEvent = {
  meeting_id: string
  recording: RecordingState | null
}

/**
 * The recording state of a meeting, for its indicator and controls. `signedIn` says whether the
 * page has a session: the state route needs one. A guest without a session gets the state in its
 * join answer (`syncState`) and on its own realtime room instead, so it never asks the route.
 * Call it in a component's setup.
 */
export function useRecording(meetingId: string, { signedIn }: { signedIn: () => boolean }) {
  const state = ref<RecordingState | null>(null)
  const globalEnabled = ref(false)
  const requestId = ref<string | null>(null)
  const socket = useSocket()
  let stateVersion = 0
  let sourceTerminal: { capture: string; state: TranscriptionCaptureState } | null = null
  let sourceInterrupted: string | null = null

  function setState(next: RecordingState | null) {
    if (
      next &&
      sourceTerminal?.capture === next.name &&
      (!next.transcription_capture_state || next.transcription_capture_state === 'capturing')
    )
      next = { ...next, transcription_capture_state: sourceTerminal.state }
    state.value = next
    stateVersion += 1
  }

  const startCall = useMutation(api.meet.recordings.start, { silent: true })
  const stopCall = useMutation(api.meet.recordings.stop, { silent: true })

  const isLive = computed(() => ['Recording', 'Interrupted'].includes(state.value?.status || ''))
  const isCapturing = computed(() => isLive.value && captureActivityLabel(state.value) !== null)
  const isStopping = computed(() => state.value?.status === 'Stopping')
  const isStarting = computed(() => ['Pending', 'Starting'].includes(state.value?.status || ''))

  async function loadState() {
    if (!signedIn()) return
    try {
      const version = stateVersion
      const recordingName = state.value?.name
      const revision = state.value?.state_revision
      const loaded = await client.query(api.meet.recordings.get, { meeting_id: meetingId })
      if (stateVersion !== version) return
      if (state.value?.state_revision !== revision) return
      if (
        loaded &&
        loaded.name === recordingName &&
        revision !== undefined &&
        loaded.state_revision < revision
      )
        return
      const wasLive = isLive.value
      setState(loaded)
      if (!wasLive && loaded?.status === 'Recording') toast.info(captureNotice(loaded))
    } catch {
      // A member the meeting no longer admits is refused; realtime still carries the state.
    }
  }

  async function start(options: CaptureOptions = defaultCaptureOptions()) {
    if (!options.video_enabled && !options.transcription_enabled)
      throw new Error(__('Select video recording or transcription'))
    if (isLive.value || isStopping.value)
      throw new Error(__('Stop the active capture before starting another'))
    requestId.value ||= randomId()
    const result = await startCall.run({
      meeting_id: meetingId,
      request_id: requestId.value,
      ...options,
    })
    if (result.status === 'Rejected') {
      setState(null)
      requestId.value = null
      if (options.transcription_enabled) await loadState()
      toast.error(
        isLive.value && state.value?.transcription_enabled
          ? __('Video recording could not start. Transcription capture continues.')
          : options.transcription_enabled
            ? __('Could not start capture. Capture capacity is unavailable.')
            : __('Could not start recording. Recording capacity is unavailable.'),
      )
      return result
    }
    if (!['Pending', 'Starting', 'Recording', 'Interrupted', 'Stopping'].includes(result.status)) {
      requestId.value = null
      await loadState()
      throw new Error(__('{0} did not start. Try again.', [captureLabel(options)]))
    }
    const preserveLiveState =
      state.value?.name === result.name && isLive.value && result.state_revision === undefined
    if (!preserveLiveState)
      setState({
        ...state.value,
        ...options,
        ...result,
        state_revision: result.state_revision ?? state.value?.state_revision ?? 0,
      })
    if (result.status === 'Recording' || options.transcription_enabled) await loadState()
    if (!['Pending', 'Starting'].includes(result.status)) requestId.value = null
    if (result.status === 'Recording' && !isCapturing.value && !isStopping.value)
      throw new Error(__('{0} did not start. Try again.', [captureLabel(options)]))
    if (['Pending', 'Starting'].includes(result.status))
      toast.info(__('{0} is starting', [captureLabel(options)]))
    else if (result.status === 'Stopping' || isStopping.value)
      toast.error(
        __('Could not start {0}. Capture is stopping.', [captureLabel(options).toLowerCase()]),
      )
    else toast.success(__('{0} started', [captureLabel(options)]))
    return result
  }

  async function stop() {
    const label = captureLabel(state.value)
    const result = await stopCall.run({ meeting_id: meetingId })
    if (!result) {
      return null
    }
    setState({
      ...state.value,
      ...result,
      state_revision: state.value?.state_revision ?? 0,
    })
    await loadState()
    toast.info(__('{0} is stopping', [label]))
    return result
  }

  function handleState(event: RecordingEvent) {
    if (event.meeting_id !== meetingId) return
    if (!event.recording) {
      const wasPending = ['Pending', 'Starting'].includes(state.value?.status || '')
      const label = captureLabel(state.value)
      setState(null)
      requestId.value = null
      if (wasPending) toast.error(__('Could not start {0}', [label.toLowerCase()]))
      return
    }
    if (
      state.value &&
      event.recording.name === state.value.name &&
      event.recording.state_revision < state.value.state_revision
    )
      return
    const previous = state.value?.status
    setState(event.recording)
    if (event.recording.status === 'Recording' && previous !== 'Recording')
      toast.info(captureNotice(event.recording))
    if (event.recording.status === 'Interrupted')
      toast.error(
        __('Could not continue {0}. Trying to recover.', [
          captureLabel(event.recording).toLowerCase(),
        ]),
      )
  }

  function syncTranscriptionCapture(value: unknown) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('room' in value) ||
      !('capture' in value) ||
      !('state' in value)
    )
      return
    const current = state.value
    if (
      !current?.transcription_enabled ||
      value.room !== meetingId ||
      value.capture !== current.name
    )
      return
    const activity = value.state
    if (
      activity !== 'capturing' &&
      activity !== 'complete' &&
      activity !== 'partial' &&
      activity !== 'failed'
    )
      return
    if (sourceTerminal?.capture === current.name && activity === 'capturing') return
    if (
      'interrupted' in value &&
      value.interrupted === true &&
      sourceInterrupted !== current.name
    ) {
      sourceInterrupted = current.name
      toast.error(
        __(
          'Transcription capture was interrupted. Missing speech will be marked in any recovered transcript.',
        ),
      )
    }
    const previous = current.transcription_capture_state
    if (activity !== 'capturing') sourceTerminal = { capture: current.name, state: activity }
    setState({ ...current, transcription_capture_state: activity })
    if (activity !== 'capturing' && previous !== activity) {
      if (sourceInterrupted !== current.name)
        toast.info(
          current.video_enabled === false ||
            current.video_capture_state === 'complete' ||
            current.video_capture_state === 'failed' ||
            !isLive.value
            ? __('Transcription capture has ended')
            : __('Transcription capture has ended. Video recording continues.'),
        )
      void loadState()
    }
  }

  function syncState(recording: RecordingState | null) {
    handleState({ meeting_id: meetingId, recording })
  }

  function beginAdmissionSync() {
    const version = stateVersion
    return (recording: RecordingState | null) => {
      if (version === stateVersion) syncState(recording)
    }
  }

  function setGlobalEnabled(enabled: boolean) {
    globalEnabled.value = enabled
  }

  onMounted(() => {
    socket?.on('meeting:recording_state', handleState)
  })
  onUnmounted(() => socket?.off('meeting:recording_state', handleState))

  return {
    state,
    globalEnabled,
    isLive,
    isCapturing,
    syncTranscriptionCapture,
    isStarting,
    startLoading: computed(() => startCall.isPending),
    stopLoading: computed(() => stopCall.isPending),
    setGlobalEnabled,
    syncState,
    beginAdmissionSync,
    start,
    stop,
  }
}
