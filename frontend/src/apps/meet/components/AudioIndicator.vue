<template>
  <div
    ref="indicator"
    class="flex items-center gap-1"
    :style="{ height: `${props.maxHeight || 80}px` }"
  >
    <div
      v-for="(bar, index) in bars"
      :key="index"
      class="audio-bar"
      :class="bar.className"
      :style="{
        height: `${props.maxHeight || 80}px`,
        transform: `scaleY(${bar.scale})`,
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

const indicator = ref<HTMLDivElement | null>(null)

const props = defineProps<{
  deviceId?: string
  mediaStream?: MediaStream
  isActive?: boolean
  sensitivity?: number
  maxHeight?: number
  activeColorClass?: string
}>()

interface BarState {
  scale: number
  className: string
}

const bars = ref<BarState[]>(
  Array.from({ length: 3 }, () => ({
    scale: Math.min(4 / (props.maxHeight || 80), 1),
    className: props.activeColorClass,
  })),
)

let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let microphone: MediaStreamAudioSourceNode | null = null
let animationWindow: Window | null = null
let animationFrame: number | null = null
let isListening = false
let localMediaStream: MediaStream | null = null

const startListening = async () => {
  if (isListening || !props.isActive) return

  try {
    isListening = true

    if (props.mediaStream) {
      localMediaStream = props.mediaStream
    } else {
      localMediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: props.deviceId,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
    }

    audioContext = new window.AudioContext()
    analyser = audioContext.createAnalyser()
    microphone = audioContext.createMediaStreamSource(localMediaStream)

    analyser.fftSize = 2048
    const bufferLength = analyser.fftSize
    const timeData = new Uint8Array(bufferLength)

    microphone.connect(analyser)

    const numBars = bars.value.length
    const smoothedLevels = new Array(numBars).fill(0)
    const maxHeight = props.maxHeight || 80

    animationWindow = indicator.value?.ownerDocument.defaultView ?? window
    const animate = () => {
      if (!analyser) return

      analyser.getByteTimeDomainData(timeData)

      let sumSquaresAll = 0
      for (let j = 0; j < bufferLength; j++) {
        const v = (timeData[j] - 128) / 128
        sumSquaresAll += v * v
      }
      const globalRms = Math.sqrt(sumSquaresAll / (bufferLength || 1))

      const time = Date.now() * 0.004
      const centerPos = (numBars - 1) / 2

      for (let i = 0; i < numBars; i++) {
        const distNorm = Math.abs(i - centerPos) / (centerPos || 1)
        const centerBias = 0.6 + (1 - distNorm) * 0.4

        const organic = Math.sin(time + i * 0.22) * 0.09 + 0.96

        const amplified = Math.sqrt(globalRms) * 0.95 + globalRms * 0.05
        const target = (amplified * centerBias * organic + 0.01) * props.sensitivity

        const responsiveSmoothing = 0.62
        smoothedLevels[i] =
          smoothedLevels[i] * responsiveSmoothing + target * (1 - responsiveSmoothing)

        const displayScale =
          Math.max(Math.min(4, maxHeight), Math.min(maxHeight, smoothedLevels[i] * maxHeight)) /
          maxHeight
        const className = props.activeColorClass

        bars.value[i] = { scale: displayScale, className }
      }

      animationFrame = animationWindow?.requestAnimationFrame(animate) ?? null
    }

    animate()
  } catch (error) {
    console.warn('Failed to start audio monitoring:', error)
    isListening = false

    bars.value = bars.value.map(() => ({
      scale: Math.min(4 / (props.maxHeight || 80), 1),
      className: props.activeColorClass,
    }))
  }
}

const stopListening = () => {
  if (!isListening) return

  isListening = false

  if (animationFrame) {
    animationWindow?.cancelAnimationFrame(animationFrame)
    animationFrame = null
  }

  animationWindow = null

  if (microphone) {
    microphone.disconnect()
    microphone = null
  }

  if (localMediaStream && !props.mediaStream) {
    for (const track of localMediaStream.getTracks()) {
      track.stop()
    }
  }
  localMediaStream = null

  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close()
    audioContext = null
  }

  analyser = null

  bars.value = bars.value.map(() => ({
    scale: Math.min(4 / (props.maxHeight || 80), 1),
    className: props.activeColorClass,
  }))
}

watch(
  () => props.deviceId,
  () => {
    if (!props.mediaStream) {
      stopListening()
      if (props.isActive) {
        startListening()
      }
    }
  },
)

let lastStreamId = null
watch(
  () => props.mediaStream,
  (newStream) => {
    if (!newStream) return

    const currentStreamId = newStream
      .getAudioTracks()
      .map((t) => t.id)
      .join(',')

    if (currentStreamId !== lastStreamId) {
      lastStreamId = currentStreamId
      stopListening()
      if (props.isActive) {
        startListening()
      }
    }
  },
)

watch(
  () => props.isActive,
  (active) => {
    if (active) {
      startListening()
    } else {
      stopListening()
    }
  },
)

onMounted(() => {
  if (props.isActive) {
    startListening()
  }
})

onUnmounted(() => {
  stopListening()
})
</script>

<style scoped>
.audio-bar {
  width: 3px;
  border-radius: 1px;
  transform-origin: center;
}
</style>
