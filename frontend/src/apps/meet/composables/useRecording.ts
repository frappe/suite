import { toast } from 'frappe-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { api, client, useMutation } from '@/api'

import type { RecordingPreflightOutput, RecordingStateOutput } from '../client/generated'
import { useSocket } from '../socket'

export type RecordingState = NonNullable<RecordingStateOutput>
export type RecordingPreflight = RecordingPreflightOutput

type RecordingEvent = {
  meeting_id: string
  recording: RecordingState | null
}

export function useRecording(meetingId: string) {
  const state = ref<RecordingState | null>(null)
  const globalEnabled = ref(false)
  const preflightPending = ref(false)
  const requestId = ref<string | null>(null)
  const socket = useSocket()
  let stateVersion = 0

  function setState(next: RecordingState | null) {
    state.value = next
    stateVersion += 1
  }

  const startCall = useMutation(api.meet.recordings.start, { silent: true })
  const stopCall = useMutation(api.meet.recordings.stop, { silent: true })

  const isLive = computed(() => ['Recording', 'Interrupted'].includes(state.value?.status || ''))
  const isStarting = computed(() => ['Pending', 'Starting'].includes(state.value?.status || ''))

  async function loadState() {
    try {
      const version = stateVersion
      const recordingName = state.value?.name
      const revision = state.value?.state_revision
      const loaded = await client.query(api.meet.recordings.get, { meeting_id: meetingId })
      if (stateVersion !== version) return
      if (state.value?.state_revision !== revision) return
      if (
        loaded?.name === recordingName &&
        revision !== undefined &&
        loaded.state_revision < revision
      )
        return
      setState(loaded)
    } catch {
      // Guests may receive state through the room-scoped realtime channel instead.
    }
  }

  async function getPreflight() {
    preflightPending.value = true
    try {
      return await client.query(api.meet.recordings.preflight, { meeting_id: meetingId })
    } finally {
      preflightPending.value = false
    }
  }

  async function start() {
    requestId.value ||= crypto.randomUUID()
    const result = await startCall.run({
      meeting_id: meetingId,
      request_id: requestId.value,
    })
    if (result.status === 'Rejected') {
      setState(null)
      requestId.value = null
      toast.error('Recording capacity is unavailable')
      return result
    }
    setState({
      ...state.value,
      ...result,
      state_revision: state.value?.state_revision ?? 0,
    })
    if (result.status === 'Recording') await loadState()
    if (!['Pending', 'Starting'].includes(result.status)) requestId.value = null
    if (['Pending', 'Starting'].includes(result.status)) toast.info('Recording is starting')
    else if (result.status === 'Stopping') toast.error('Recording could not start and is stopping')
    else toast.success('Recording started')
    return result
  }

  async function stop() {
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
    toast.info('Recording is stopping')
    return result
  }

  function handleState(event: RecordingEvent) {
    if (event.meeting_id !== meetingId) return
    if (!event.recording) {
      const wasPending = ['Pending', 'Starting'].includes(state.value?.status || '')
      setState(null)
      requestId.value = null
      if (wasPending) toast.error('Recording could not start')
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
      toast.info('This meeting is being recorded')
    if (event.recording.status === 'Interrupted')
      toast.error('Recording was interrupted and is trying to recover')
  }

  function syncState(recording: RecordingState | null) {
    handleState({ meeting_id: meetingId, recording })
  }

  function setGlobalEnabled(enabled: boolean) {
    globalEnabled.value = enabled
  }

  onMounted(() => {
    void loadState()
    socket?.on('meeting:recording_state', handleState)
  })
  onUnmounted(() => socket?.off('meeting:recording_state', handleState))

  return {
    state,
    globalEnabled,
    isLive,
    isStarting,
    preflightLoading: computed(() => preflightPending.value),
    startLoading: computed(() => startCall.isPending),
    stopLoading: computed(() => stopCall.isPending),
    getPreflight,
    setGlobalEnabled,
    syncState,
    start,
    stop,
  }
}
