<script setup lang="ts">
import { Editor, EditorContent } from '@tiptap/vue-3'
import { Skeleton } from 'frappe-ui'
import { inject, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { DOCUMENT_MEDIA, DriveMedia } from '@/apps/writer/extensions/drive-media'
import { writerSchema } from '@/apps/writer/schema'
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
  settings: LayoutSettings
}>()

const media = inject(DOCUMENT_MEDIA, null)
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
  <div class="min-w-0 flex-1 overflow-y-auto overflow-x-hidden md:border-l border-outline-gray-2">
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
</template>
