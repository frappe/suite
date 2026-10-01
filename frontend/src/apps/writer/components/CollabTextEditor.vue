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
  />
</template>

<script setup>
import { computed, provide, ref } from 'vue'
import { toast } from 'frappe-ui'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { FIELD } from '@/apps/writer/collab'
import CoreEditor from './CoreEditor.vue'

const props = defineProps({
  room: Object,
  file: Object,
  document: Object,
  settings: Object,
  editable: Boolean,
})

const showSettings = defineModel('showSettings')
const edited = ref(false)
const textEditor = ref(null)
const editor = computed(() => textEditor.value?.editor)
provide('editor', editor)
defineExpose({ editor, users: [] })

// Collaborative documents carry no comments yet
const comments = new Y.Doc().getMap('comments')
const extensions = [Collaboration.configure({ document: props.room.doc, field: FIELD })]

async function save(_manual, _html, done) {
  await Promise.race([props.room.flush(), new Promise((resolve) => setTimeout(resolve, 10_000))])
  if (props.room.saveState === 'clean') done?.()
  else if (done) toast.warning('Not saved yet. Your changes are kept in this tab.')
}
</script>
