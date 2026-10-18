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
    :comment-on-selection
    collaborative
    @save="(_manual: boolean, _html: string | null, done?: () => void) => save(done)"
  >
    <template v-for="(_, name) in $slots" #[name]>
      <slot :name="name" />
    </template>
  </CoreEditor>
</template>

<script setup lang="ts">
import type { CollabRoom } from '@suite/collab-client'
import { toast } from 'frappe-ui'
import { computed, onBeforeUnmount, provide, ref, shallowRef, watch } from 'vue'
import * as Y from 'yjs'

import type { DocumentThread } from '@/apps/drive'
import { writerAdapter } from '@/apps/writer/collab/adapter'
import { CommentShortcut } from '@/apps/writer/collab/commentShortcut'
import {
  redrawThreads,
  showThread,
  ThreadHighlights,
  type ThreadPlaces,
} from '@/apps/writer/collab/highlights'
import { peopleOf, presenceColours } from '@/apps/writer/collab/peers'
import { anchorSelection } from '@/apps/writer/collab/places'
import { withinTenSeconds } from '@/apps/writer/collab/timeout'
import { PasteSizeGuard } from '@/apps/writer/extensions/paste-size-guard'
import type {
  EditorFile,
  WriterDocument,
  WriterSettings,
} from '@/apps/writer/surface/writerDocument'

import CoreEditor from './CoreEditor.vue'

const props = defineProps<{
  room: CollabRoom
  file: EditorFile
  document: WriterDocument
  settings: WriterSettings
  editable: boolean
  threads: DocumentThread[]
  /** The thread whose row is pointed at in the comments panel. */
  litThread?: string | null
}>()

const showSettings = defineModel('showSettings')
/** The thread open in the comments panel; clicking its highlighted text opens it. */
const openThread = defineModel<string | null>('openThread', { default: null })
const emit = defineEmits<{ comment: [anchor: string]; commentOnDocument: [] }>()

const edited = ref(false)
const textEditor = ref<InstanceType<typeof CoreEditor> | null>(null)

const editor = computed(() => textEditor.value?.editor)
provide('editor', editor)

const presence = props.room.presence
const roster = shallowRef(presence?.peers ?? [])
const stopListening = presence?.onChange(() => (roster.value = presence.peers))
onBeforeUnmount(() => stopListening?.())

const peers = computed(() => {
  const colours = presence && presenceColours(presence)
  return peopleOf(roster.value, colours || new Map())
})
const places = shallowRef<ThreadPlaces>(new Map())
const isFrozen = ref(false)
defineExpose({ editor, peers, places, isFrozen })

function onFrozen() {
  isFrozen.value = true
}

// Collaborative documents carry no comments yet
const comments = new Y.Doc().getMap('comments')

const extensions = [
  ...writerAdapter.bind(props.room, onFrozen),
  PasteSizeGuard.configure({
    limits: () => props.room.limits,
    atLimit: () => props.room.atLimit,
    onTooLarge: () => toast.error('This is too large to add in one go. Add it in smaller parts.'),
    onNearFull: () => toast.warning('This document is nearly full. Some changes may not save.'),
  }),
  ThreadHighlights.configure({
    threads: () => props.threads,
    placed: (placed) => {
      places.value = placed
    },
    open: () => openThread.value,
    lit: () => props.litThread ?? null,
    opened: (name) => {
      openThread.value = name
    },
  }),
  CommentShortcut.configure({
    onText: commentOnSelection,
    onDocument: () => emit('commentOnDocument'),
  }),
]

watch([() => props.threads, openThread, () => props.litThread], () => {
  if (editor.value) {
    redrawThreads(editor.value.view)
  }
})

watch(openThread, (name) => {
  if (name && editor.value) {
    showThread(editor.value.view, name)
  }
})

function commentOnSelection() {
  const anchor = editor.value && anchorSelection(editor.value.state)
  if (anchor) {
    emit('comment', anchor)
  }
}

async function save(done?: () => void) {
  await withinTenSeconds(props.room.flush())
  if (props.room.saveState === 'clean') {
    done?.()
  } else if (done) {
    toast.warning('Not saved yet. Your changes are kept in this tab.')
  }
}
</script>
