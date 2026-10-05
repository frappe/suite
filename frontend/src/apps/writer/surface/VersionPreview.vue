<script setup lang="ts">
import { Editor, EditorContent } from '@tiptap/vue-3'
import { Button, Skeleton } from 'frappe-ui'
import { inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { DOCUMENT_MEDIA, DriveMedia } from '@/apps/writer/extensions/drive-media'
import { writerSchema } from '@/apps/writer/schema'

import { readVersion } from './versions'

const props = defineProps<{ session: DocumentSession; seq: number; label: string }>()
const emit = defineEmits<{ close: [] }>()

const media = inject(DOCUMENT_MEDIA, null)
const editor = shallowRef<Editor | null>(null)
const loading = ref(true)
const failed = ref(false)

async function show(seq: number) {
  editor.value?.destroy()
  editor.value = null
  loading.value = true
  failed.value = false
  try {
    const response = await props.session.credentials.fetch(
      props.session.versions.contentUrl(String(seq)),
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const content = await readVersion(new Uint8Array(await response.arrayBuffer()))
    if (seq !== props.seq) return
    editor.value = new Editor({
      extensions: [...writerSchema(), DriveMedia.configure({ media })],
      content,
      editable: false,
      // HTML parses as loosely as the live editor; only Yjs state is checked.
      enableContentCheck: typeof content !== 'string',
      onContentError: () => {
        failed.value = true
      },
    })
  } catch {
    if (seq === props.seq) failed.value = true
  } finally {
    if (seq === props.seq) loading.value = false
  }
}

watch(() => props.seq, show, { immediate: true })
onBeforeUnmount(() => editor.value?.destroy())
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex shrink-0 items-center gap-3 border-b border-outline-gray-1 bg-surface-gray-1 px-5 py-2"
      role="status"
    >
      <p class="truncate text-sm text-ink-gray-7">Viewing {{ label }}</p>
      <Button size="sm" label="Back to current" @click="emit('close')" />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="mx-auto w-full max-w-[770px] space-y-3 px-5 pt-10">
        <Skeleton
          v-for="width in ['70%', '92%', '84%', '60%']"
          :key="width"
          class="h-3.5 rounded-4"
          :style="{ width }"
        />
      </div>
      <p v-else-if="failed" class="m-auto px-5 pt-10 text-center text-p-sm text-ink-gray-6">
        This version can't be shown.
      </p>
      <EditorContent
        v-else
        :editor="editor ?? undefined"
        aria-label="Version preview"
        class="mx-auto w-full max-w-[770px] pt-10 pb-24 px-5 prose prose-sm prose-v3 prose-table:table-fixed prose-td:p-2 prose-th:p-2 prose-td:border prose-th:border prose-td:relative prose-th:relative prose-th:bg-surface-gray-2"
      />
    </div>
  </div>
</template>
