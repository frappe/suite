<!--
  PROTOTYPE — remove. The preview pane for a PDF row.

  A PDF is the one file kind in the fixtures with no editor behind it. It still
  has to open somewhere, so it opens here: the same doc area the three editors
  use, with the viewer chrome a reader expects.

  The page is a real PDF, rendered by pdf.js on a canvas — the same renderer
  Drive's own preview falls back to. It is one sample file for every row: the
  fixtures name files that do not exist, so there is nothing else to fetch. The
  header still carries the name that was clicked.
-->
<template>
  <div class="flex h-full min-h-0 flex-1 flex-col">
    <div
      class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-outline-gray-1 px-3"
    >
      <!-- Tabular figures: the count must not shift when the page total does. -->
      <span class="pl-1 text-base tabular-nums text-ink-gray-6">
        {{ pageCount }} {{ pageCount === 1 ? 'page' : 'pages' }}
      </span>

      <div class="flex items-center gap-0.5">
        <Tooltip placement="bottom">
          <Button
            variant="ghost"
            icon="lucide-zoom-out"
            aria-label="Zoom out"
            :disabled="zoomIndex === 0"
            @click="zoomIndex -= 1"
          />
          <template #content>Zoom out</template>
        </Tooltip>
        <span class="w-11 text-center text-base tabular-nums text-ink-gray-6">
          {{ Math.round(zoom * 100) }}%
        </span>
        <Tooltip placement="bottom">
          <Button
            variant="ghost"
            icon="lucide-zoom-in"
            aria-label="Zoom in"
            :disabled="zoomIndex === ZOOMS.length - 1"
            @click="zoomIndex += 1"
          />
          <template #content>Zoom in</template>
        </Tooltip>

        <span class="mx-1 h-4 border-l border-outline-gray-2" aria-hidden="true" />

        <Tooltip placement="bottom">
          <Button variant="ghost" icon="lucide-printer" aria-label="Print" />
          <template #content>Print</template>
        </Tooltip>
        <Tooltip placement="bottom">
          <Button variant="ghost" icon="lucide-download" aria-label="Download" />
          <template #content>Download</template>
        </Tooltip>
        <Dropdown :options="moreOptions" align="end">
          <Button variant="ghost" icon="lucide-ellipsis" aria-label="More actions" />
        </Dropdown>
      </div>
    </div>

    <ScrollArea class="min-h-0 flex-1 bg-surface-gray-2" viewport-class="p-6">
      <div class="flex flex-col items-center">
        <!-- The sheet holds its size from the first render on, so the pane does
             not jump when the page paints or when the zoom changes. -->
        <div
          class="shrink-0 overflow-hidden rounded-4 bg-white shadow-sm ring-1 ring-outline-gray-2"
          :style="sheetSize"
        >
          <canvas ref="canvasEl" class="block" />
        </div>
        <span v-if="loading" class="mt-4 text-base text-ink-gray-5">Loading preview…</span>
      </div>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button, Dropdown, ScrollArea, Tooltip } from 'frappe-ui'
import * as PDFJS from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

// The worker is a real module URL, so Vite bundles it instead of asking the
// page for a file that is not served.
PDFJS.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// One sample page stands in for every PDF row in the fixtures.
import sampleUrl from '../sample.pdf?url'

defineProps<{ id: string }>()

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5]
const zoomIndex = ref(2)
const zoom = computed(() => ZOOMS[zoomIndex.value])

const canvasEl = ref<HTMLCanvasElement | null>(null)
const loading = ref(true)
const pageCount = ref(1)
// Set from the page's own viewport, so the sheet is the size the file says.
const sheetSize = ref<Record<string, string>>({})

let doc: PDFDocumentProxy | null = null
let task: RenderTask | null = null

async function render() {
  const canvas = canvasEl.value
  if (!doc || !canvas) return

  const page = await doc.getPage(1)
  // Render at device pixels and scale back down in CSS: a canvas sized in CSS
  // pixels alone is soft on a retina screen and softer again at 150%.
  const ratio = window.devicePixelRatio || 1
  const viewport = page.getViewport({ scale: zoom.value * ratio })
  const width = viewport.width / ratio
  const height = viewport.height / ratio

  canvas.width = viewport.width
  canvas.height = viewport.height
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  sheetSize.value = { width: `${width}px`, height: `${height}px` }

  task?.cancel()
  task = page.render({ canvasContext: canvas.getContext('2d')!, viewport })
  // A cancelled render is the expected outcome of a fast second zoom click.
  await task.promise.catch(() => {})
}

onMounted(async () => {
  doc = await PDFJS.getDocument(sampleUrl).promise
  pageCount.value = doc.numPages
  await render()
  loading.value = false
})

watch(zoom, render)

onBeforeUnmount(() => {
  task?.cancel()
  doc?.destroy()
})

const moreOptions = [
  { label: 'Open in new tab', icon: 'lucide-external-link', onClick: () => {} },
  { label: 'Copy link', icon: 'lucide-link', onClick: () => {} },
  { label: 'Share', icon: 'lucide-user-plus', onClick: () => {} },
  { label: 'Rename', icon: 'lucide-pencil', onClick: () => {} },
]
</script>
