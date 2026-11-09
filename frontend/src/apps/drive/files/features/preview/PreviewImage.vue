<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core'
import { Spinner } from 'frappe-ui'
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'

import { previewImage } from './imageCache'
import PreviewFailed from './PreviewFailed.vue'

/**
 * The preview's picture: the element the image cache keeps loaded. It fades
 * in, shows a spinner after a short wait, and offers Download when the
 * picture does not load.
 */
const props = defineProps<{
  src: string
  alt: string
  download: string
}>()

const host = useTemplateRef<HTMLElement>('host')
const status = ref<'loading' | 'ready' | 'failed'>('loading')
const slow = ref(false)
const wait = useTimeoutFn(() => (slow.value = true), 300, { immediate: false })
/** The element this preview shows, or waits for when `outgoing` is still up. */
let shown: HTMLImageElement | null = null
/** The loaded picture that stays up while a new address for the same file loads. */
let outgoing: HTMLImageElement | null = null

function show(src: string) {
  if (status.value === 'ready' && !outgoing) outgoing = shown
  else shown?.remove()
  const image = previewImage(src)
  image.alt = props.alt
  image.className = 'm-auto max-h-full min-h-0 max-w-full object-contain p-4'
  image.style.transition = 'opacity 150ms ease-out'
  shown = image
  slow.value = false
  // The cache lets go of a failed element, so a complete one has loaded.
  if (image.complete) return settle(image, 'ready')
  image.style.opacity = '0'
  image.addEventListener('load', () => settle(image, 'ready'), { once: true })
  image.addEventListener('error', () => settle(image, 'failed'), { once: true })
  if (outgoing) return
  status.value = 'loading'
  wait.start()
  host.value?.append(image)
}

/** A kept element may finish after this preview moved on, so only the shown one counts. */
function settle(image: HTMLImageElement, outcome: 'ready' | 'failed') {
  if (image !== shown) return
  wait.stop()
  outgoing?.remove()
  outgoing = null
  status.value = outcome
  if (outcome === 'failed') return image.remove()
  image.style.opacity = ''
  if (!image.isConnected) host.value?.append(image)
}

onMounted(() => show(props.src))
watch(() => props.src, show)
watch(
  () => props.alt,
  (alt) => shown && (shown.alt = alt),
)
onBeforeUnmount(() => {
  shown?.remove()
  outgoing?.remove()
})
</script>

<template>
  <div ref="host" class="relative flex min-h-0 flex-1">
    <Spinner
      v-if="status === 'loading' && slow"
      size="lg"
      theme="gray"
      class="absolute inset-0 m-auto"
    />
    <PreviewFailed v-if="status === 'failed'" :download="download" />
  </div>
</template>
