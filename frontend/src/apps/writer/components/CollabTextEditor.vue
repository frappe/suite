<template>
  <CoreEditor
    ref="textEditor"
    v-model:show-settings="showSettings"
    v-model:edited="edited"
    :file
    :document
    :settings
    :editable
    :comments
    :extensions
    @save="save"
  >
    <template v-for="(_, name) in $slots" #[name]>
      <slot :name="name" />
    </template>
  </CoreEditor>
</template>

<script setup lang="ts">
import type { CollabRoom } from '@suite/collab-client'
import Collaboration from '@tiptap/extension-collaboration'
import { toast } from 'frappe-ui'
import { computed, provide, ref } from 'vue'
import * as Y from 'yjs'

import { FIELD, withinTenSeconds } from '@/apps/writer/collab'
import { PasteSizeGuard } from '@/apps/writer/extensions/paste-size-guard'

import CoreEditor from './CoreEditor.vue'

const props = defineProps<{
  room: CollabRoom
  file: object
  document: object
  settings: object
  editable: boolean
}>()

const showSettings = defineModel('showSettings')
const edited = ref(false)
const textEditor = ref<InstanceType<typeof CoreEditor> | null>(null)
const editor = computed(() => textEditor.value?.editor)
provide('editor', editor)
defineExpose({ editor })

// Collaborative documents carry no comments yet
const comments = new Y.Doc().getMap('comments')
const extensions = [
  Collaboration.configure({ document: props.room.doc, field: FIELD }),
  PasteSizeGuard.configure({
    limits: () => props.room.limits,
    tooLarge: () =>
      toast.error('This is too large to add in one go. Insert large images as files.'),
    nearFull: () => toast.warning('This document is nearly full. Some changes may not save.'),
  }),
]

async function save(_manual: boolean, _html: string | null, done?: () => void) {
  await withinTenSeconds(props.room.flush())
  if (props.room.saveState === 'clean') done?.()
  else if (done) toast.warning('Not saved yet. Your changes are kept in this tab.')
}
</script>
