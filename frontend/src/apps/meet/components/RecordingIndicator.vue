<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { translate as __ } from '@/platform/translation'

import type { RecordingState } from '../composables/useRecording'
import { captureActivityLabel, captureLabel, captureNotice } from '../utils/capturePresentation'

const props = withDefaults(defineProps<{ recording: RecordingState; canStop?: boolean }>(), {
  canStop: false,
})
const emit = defineEmits<{ click: [] }>()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

const elapsed = computed(() => {
  if (!props.recording.started_at) return '00:00'
  const startedAt = props.recording.started_at.includes('T')
    ? props.recording.started_at
    : props.recording.started_at.replace(' ', 'T')
  const timestamp = /(?:Z|[+-]\d\d:\d\d)$/.test(startedAt) ? startedAt : `${startedAt}Z`
  const seconds = Math.max(0, Math.floor((now.value - new Date(timestamp).getTime()) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder]
    .flatMap((part, index) => (hours > 0 || index > 0 ? [String(part).padStart(2, '0')] : []))
    .join(':')
})

const interruptionLabel = computed(() => {
  const activity = captureActivityLabel(props.recording) || __('Capture')
  if (!props.recording.interruption_deadline) return __('{0} interrupted', [activity])
  const deadline = props.recording.interruption_deadline.includes('T')
    ? props.recording.interruption_deadline
    : props.recording.interruption_deadline.replace(' ', 'T')
  const timestamp = /(?:Z|[+-]\d\d:\d\d)$/.test(deadline) ? deadline : `${deadline}Z`
  const seconds = Math.max(0, Math.ceil((new Date(timestamp).getTime() - now.value) / 1000))
  return __('{0} interrupted - {1}s', [activity, seconds])
})

onMounted(() => (timer = setInterval(() => (now.value = Date.now()), 1000)))
onUnmounted(() => timer && clearInterval(timer))
</script>

<template>
  <Button
    :theme="recording.status === 'Interrupted' ? 'amber' : 'red'"
    variant="subtle"
    size="sm"
    :icon-left="recording.status === 'Interrupted' ? 'lucide-triangle-alert' : 'lucide-circle-stop'"
    :label="
      recording.status === 'Interrupted'
        ? interruptionLabel
        : `${captureActivityLabel(recording)} ${elapsed}`
    "
    :aria-label="
      recording.status === 'Interrupted'
        ? interruptionLabel
        : `${captureNotice(recording)} ${elapsed}`
    "
    :disabled="!canStop || recording.status === 'Stopping'"
    role="status"
    aria-live="polite"
    :tooltip="
      canStop ? __('Stop {0}', [captureLabel(recording).toLowerCase()]) : captureNotice(recording)
    "
    @click="emit('click')"
  />
</template>
