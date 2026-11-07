<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { Button, Spinner } from 'frappe-ui'
import { nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from '@/platform/pdf'
import { translate as __ } from '@/platform/translation'

import PreviewFallback from './PreviewFallback.vue'

/**
 * A PDF in a frame on a wide screen. Mobile Safari shows one page of a framed
 * PDF, or none, so a phone draws each page with pdf.js as it scrolls into view.
 */
const props = defineProps<{ src: string; download: string; title: string }>()

const narrow = useMediaQuery('(max-width: 767px)')
const pageCount = ref(0)
/** Each page's box takes the first page's shape until the page is drawn. */
const pageShape = ref('3 / 4')
const failed = ref(false)
const list = useTemplateRef<HTMLElement>('list')
let pdf: PDFDocumentProxy | null = null
let loading: PDFDocumentLoadingTask | null = null
let observer: IntersectionObserver | null = null
/** Counts each open, so the work of a closed document stops at its next step. */
let opened = 0

watch(
  [narrow, () => props.src],
  ([isNarrow]) => {
    close()
    if (isNarrow) void open()
  },
  { immediate: true },
)
onBeforeUnmount(close)

async function open() {
  const own = ++opened
  failed.value = false
  try {
    // pdf.js loads only when a phone opens a PDF.
    const { pdfjs } = await import('@/platform/pdf')
    if (own !== opened) return
    loading = pdfjs.getDocument(props.src)
    const loaded = await loading.promise
    const first = (await loaded.getPage(1)).getViewport({ scale: 1 })
    if (own !== opened) return
    pdf = loaded
    pageShape.value = `${first.width} / ${first.height}`
    pageCount.value = loaded.numPages
    await nextTick()
    observePages()
  } catch {
    if (own === opened) failed.value = true
  }
}

function close() {
  opened += 1
  observer?.disconnect()
  observer = null
  void loading?.destroy()
  loading = null
  pdf = null
  pageCount.value = 0
}

function observePages() {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue
        observer?.unobserve(entry.target)
        void drawPage(entry.target)
      }
    },
    // A screen ahead, so a page is drawn before it shows.
    { root: list.value, rootMargin: '100% 0px' },
  )
  for (const box of list.value?.querySelectorAll('[data-page]') ?? []) observer.observe(box)
}

/** Draws the page at the box's width, sharp on a high-density screen. */
async function drawPage(box: HTMLElement) {
  const own = opened
  const canvas = box.querySelector('canvas')
  if (!pdf || !canvas) return
  try {
    const page = await pdf.getPage(Number(box.dataset.page))
    const natural = page.getViewport({ scale: 1 })
    const density = Math.min(window.devicePixelRatio || 1, 2)
    const viewport = page.getViewport({ scale: (box.clientWidth / natural.width) * density })
    if (own !== opened) return
    box.style.aspectRatio = `${natural.width} / ${natural.height}`
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    await page.render({ canvas, viewport }).promise
  } catch {
    if (own === opened) failed.value = true
  }
}
</script>

<template>
  <iframe
    v-if="!narrow"
    :src="src"
    :title="title"
    class="min-h-0 flex-1 border-0 bg-surface-base"
  />
  <PreviewFallback
    v-else-if="failed"
    :title="__('Could not show this PDF')"
    :message="__('Open it in a new tab, or download it.')"
    :download="download"
  >
    <Button :label="__('Open in new tab')" icon-left="lucide-external-link" :href="src" />
  </PreviewFallback>
  <div
    v-else
    ref="list"
    class="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface-gray-2"
    :aria-label="title"
    :aria-busy="!pageCount"
  >
    <div v-if="!pageCount" class="flex h-full">
      <Spinner size="lg" theme="gray" class="m-auto" />
    </div>
    <div v-else class="mx-auto flex max-w-3xl flex-col gap-3 p-3">
      <div
        v-for="page in pageCount"
        :key="page"
        :data-page="page"
        class="overflow-hidden rounded-2 bg-surface-white shadow-sm"
        :style="{ aspectRatio: pageShape }"
      >
        <canvas
          class="block size-full"
          role="img"
          :aria-label="__('Page {0} of {1}', [page, pageCount])"
        />
      </div>
    </div>
  </div>
</template>
