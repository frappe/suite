<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core'
import { Spinner } from 'frappe-ui'
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'

import { translate as __ } from '@/platform/translation'

import { holdImages, previewImage } from './imageCache'
import PreviewFallback from './PreviewFallback.vue'

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
const release = holdImages()
let shown: HTMLImageElement | null = null

function show(src: string) {
  shown?.remove()
  const image = previewImage(src)
  image.alt = props.alt
  image.className = 'm-auto max-h-full min-h-0 max-w-full object-contain p-4'
  shown = image
  const ready = image.complete && image.naturalWidth > 0
  status.value = ready ? 'ready' : 'loading'
  slow.value = false
  image.style.opacity = ready ? '' : '0'
  image.style.transition = 'opacity 150ms ease-out'
  if (!ready) {
    wait.start()
    image.addEventListener('load', () => settle(image, 'ready'), { once: true })
    image.addEventListener('error', () => settle(image, 'failed'), { once: true })
  }
  host.value?.append(image)
}

/** A kept element may finish after this preview moved on, so only the shown one counts. */
function settle(image: HTMLImageElement, outcome: 'ready' | 'failed') {
  if (image !== shown) return
  wait.stop()
  status.value = outcome
  if (outcome === 'ready') image.style.opacity = ''
  else image.remove()
}

onMounted(() => show(props.src))
watch(() => props.src, show)
watch(
  () => props.alt,
  (alt) => shown && (shown.alt = alt),
)
onBeforeUnmount(() => {
  shown?.remove()
  release()
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
    <PreviewFallback
      v-if="status === 'failed'"
      :title="__('Could not load the preview')"
      :message="__('Download this file to open it.')"
      :download="download"
    />
  </div>
</template>
