<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { Skeleton } from 'frappe-ui'
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import PreviewPane from '@/apps/writer/components/PreviewPane.vue'
import { DOCUMENT_MEDIA } from '@/apps/writer/extensions/drive-media'
import { orderedHTML } from '@/apps/writer/extensions/tabs'
import type { LayoutSettings } from '@/apps/writer/utils/editor-layout'
import { previewEditor } from '@/apps/writer/utils/preview-editor'

import { fetchVersion, readVersion } from './versions'

const props = defineProps<{
  session: DocumentSession
  seq: number
  settings: LayoutSettings
}>()

const media = inject(DOCUMENT_MEDIA, null)

const editor = shallowRef<Editor | null>(null)
const loading = ref(true)
const failed = ref(false)
/** The version the editor holds, which lags `seq` while the next one loads. */
const shown = shallowRef<{ seq: number; firstTabLabel: string | null } | null>(null)
const isShown = computed(() => !failed.value && shown.value?.seq === props.seq)

let latestRequest = 0

async function showVersion(seq: number) {
  const thisRequest = ++latestRequest
  loading.value = !editor.value

  try {
    const version = await readVersion(await fetchVersion(props.session, seq))
    if (thisRequest !== latestRequest) return

    const previousEditor = editor.value
    failed.value = false
    shown.value = { seq, firstTabLabel: version.firstTabLabel }
    editor.value = previewEditor(version.content, media, () => {
      failed.value = true
    })
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

watch(() => props.seq, showVersion, { immediate: true })

/** The shown version as the live document's "All tabs" export writes it, or null while none is shown. */
function versionHTML() {
  if (!isShown.value || !editor.value) {
    return null
  }

  return orderedHTML(editor.value.state.doc, shown.value!.firstTabLabel)
}

defineExpose({ isShown, versionHTML })

onBeforeUnmount(() => {
  latestRequest++
  editor.value?.destroy()
})
</script>

<template>
  <PreviewPane
    :editor="editor"
    :settings="settings"
    label="Version preview"
    :is-loading="loading"
    :is-failed="failed"
  >
    <template #loading>
      <div class="space-y-3 px-5 pt-10">
        <Skeleton
          v-for="width in ['70%', '92%', '84%', '60%']"
          :key="width"
          class="h-3.5 rounded-4"
          :style="{ width }"
        />
      </div>
    </template>
    <template #failed>This version can't be shown.</template>
  </PreviewPane>
</template>
