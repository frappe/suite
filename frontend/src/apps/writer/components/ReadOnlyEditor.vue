<template>
  <CoreEditor ref="textEditor" v-bind="{ ...props, ...body }" :editable="false">
    <template v-for="(_, name) in $slots" #[name]>
      <slot :name="name" />
    </template>
  </CoreEditor>
</template>

<script setup lang="ts">
import Collaboration from '@tiptap/extension-collaboration'
import { computed, onBeforeUnmount, provide, ref, useTemplateRef } from 'vue'

import { readLegacy } from '@/apps/writer/collab/legacy-read'
import type {
  EditorFile,
  WriterDocument,
  WriterSettings,
} from '@/apps/writer/surface/writerDocument'

import CoreEditor from './CoreEditor.vue'

defineOptions({ inheritAttrs: false })

/** An old document the converter hasn't made collaborative yet, shown as its row stores it. */
const props = defineProps<{
  file: EditorFile
  document: WriterDocument
  settings: WriterSettings
}>()

const row = props.document.doc!
const read = readLegacy({
  content: row.content ?? null,
  html: row.html ?? null,
  collab: row.collab ?? 0,
  ycomments: row.ycomments ?? null,
})
// Yjs bytes that don't decode, or hold what this editor can't place, show as the stored HTML
const isUnreadable = ref(read.case === 'unreadable-yjs')
const body = computed(() => {
  if (read.case !== 'yjs' || isUnreadable.value) {
    return { key: 'html', rawContent: row.html ?? '' }
  }

  const sync = Collaboration.configure({
    document: read.old,
    field: 'default',
    ySyncOptions: {
      onUnplaceable: () => {
        isUnreadable.value = true
      },
    },
  })
  return { key: 'yjs', extensions: [sync], collaborative: true }
})

const textEditor = useTemplateRef('textEditor')
const editor = computed(() => textEditor.value?.editor)
provide('editor', editor)
defineExpose({ editor, isUnreadable })

onBeforeUnmount(() => {
  if ('old' in read) {
    read.old.destroy()
  }
})
</script>
