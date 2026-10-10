<script setup lang="ts">
import type { EditorOptions } from '@tiptap/core'
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

import { readVersion, type VersionContent } from './versions'

const props = defineProps<{
  session: DocumentSession
  seq: number
  settings: LayoutSettings
}>()

const media = inject(DOCUMENT_MEDIA, null)

const editor = shallowRef<Editor | null>(null)
const loading = ref(true)
const failed = ref(false)

let latestRequest = 0

async function showVersion(seq: number) {
  const thisRequest = ++latestRequest
  loading.value = !editor.value

  try {
    const content = await fetchVersion(seq)
    if (thisRequest !== latestRequest) return

    const previousEditor = editor.value
    failed.value = false
    editor.value = previewEditor(content)
    await nextTick()
    previousEditor?.destroy()
  } catch {
    if (thisRequest === latestRequest) {
      failed.value = true
    }
  } finally {
    if (thisRequest === latestRequest) {
      loading.value = false
    }
  }
}

async function fetchVersion(seq: number) {
  const url = props.session.versions.contentUrl(String(seq))
  const response = await props.session.credentials.fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const buffer = await response.arrayBuffer()
  return readVersion(new Uint8Array(buffer))
}

function previewEditor(content: VersionContent) {
  const options: Partial<EditorOptions> = {
    extensions: [...writerSchema(), DriveMedia.configure({ media })],
    content,
    editable: false,
    editorProps: { attributes: { class: `${EDITOR_TEXT_CLASS} max-w-none` } },
    // HTML parses as loosely as the live editor; only Yjs state is checked.
    enableContentCheck: typeof content !== 'string',
    onContentError: () => {
      failed.value = true
    },
  }
  return new Editor(options)
}

watch(() => props.seq, showVersion, { immediate: true })

onBeforeUnmount(() => {
  latestRequest++
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
