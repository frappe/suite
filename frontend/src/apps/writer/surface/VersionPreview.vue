<script setup lang="ts">
import { Editor, EditorContent } from '@tiptap/vue-3'
import { Button, Skeleton } from 'frappe-ui'
import { inject, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { DOCUMENT_MEDIA, DriveMedia } from '@/apps/writer/extensions/drive-media'
import { writerSchema } from '@/apps/writer/schema'
import { SIDE_PANEL } from '@/apps/writer/sidePanel'
import {
  EDITOR_TEXT_CLASS,
  editorColumns,
  editorTextStyle,
  type LayoutSettings,
} from '@/apps/writer/utils/editor-layout'

import { readVersion } from './versions'

const props = defineProps<{
  session: DocumentSession
  seq: number
  label: string
  settings: LayoutSettings
  /** Width, in px, the live editor gives its table of contents, so the text lines up. */
  rail: number
}>()
const emit = defineEmits<{ close: [] }>()

const media = inject(DOCUMENT_MEDIA, null)
const sidePanel = inject(SIDE_PANEL, ref(false))
const editor = shallowRef<Editor | null>(null)
const loading = ref(true)
const failed = ref(false)
let request = 0

async function show(seq: number) {
  const current = ++request
  loading.value = !editor.value
  try {
    const response = await props.session.credentials.fetch(
      props.session.versions.contentUrl(String(seq)),
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const content = await readVersion(new Uint8Array(await response.arrayBuffer()))
    if (current !== request) return
    const shown = editor.value
    failed.value = false
    editor.value = new Editor({
      extensions: [...writerSchema(), DriveMedia.configure({ media })],
      content,
      editable: false,
      editorProps: { attributes: { class: `${EDITOR_TEXT_CLASS} max-w-none` } },
      // HTML parses as loosely as the live editor; only Yjs state is checked.
      enableContentCheck: typeof content !== 'string',
      onContentError: () => {
        failed.value = true
      },
    })
    await nextTick()
    shown?.destroy()
  } catch {
    if (current === request) failed.value = true
  } finally {
    if (current === request) loading.value = false
  }
}

watch(() => props.seq, show, { immediate: true })
onBeforeUnmount(() => {
  request++
  editor.value?.destroy()
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex shrink-0 items-center justify-between gap-3 border-b border-outline-gray-1 bg-surface-gray-1 px-5 py-1.5"
      role="status"
    >
      <p class="truncate text-sm text-ink-gray-7">Viewing {{ label }}</p>
      <Button size="sm" variant="outline" label="Back to current" @click="emit('close')" />
    </div>
    <div class="flex min-h-0 flex-1">
      <div class="hidden shrink-0 md:block" :style="{ width: `${rail}px` }" />
      <div
        class="min-w-0 flex-1 overflow-y-auto overflow-x-hidden md:border-l border-outline-gray-2"
      >
        <div
          class="min-h-full flex flex-col md:grid md:grid-rows-[1fr]"
          :style="editorColumns(settings)"
        >
          <div class="hidden md:block" />
          <div v-if="loading" class="space-y-3 px-5 pt-10">
            <Skeleton
              v-for="width in ['70%', '92%', '84%', '60%']"
              :key="width"
              class="h-3.5 rounded-4"
              :style="{ width }"
            />
          </div>
          <p v-else-if="failed" class="px-5 pt-10 text-center text-p-sm text-ink-gray-6">
            This version can't be shown.
          </p>
          <EditorContent
            v-else
            :editor="editor ?? undefined"
            aria-label="Version preview"
            class="flex grow flex-col"
            :style="editorTextStyle(settings)"
          />
        </div>
      </div>
      <div v-if="sidePanel" class="hidden w-80 shrink-0 md:block" />
    </div>
  </div>
</template>
