<template>
  <CoreEditor
    ref="textEditor"
    v-model:show-settings="showSettings"
    v-model:edited="edited"
    :file
    :document
    :settings
    :editable
    :extensions
    :comment-on-selection
    collaborative
    @save="handleSave"
  >
    <template v-for="(_, name) in $slots" #[name]>
      <slot :name="name" />
    </template>
  </CoreEditor>
</template>

<script setup lang="ts">
import { toast } from 'frappe-ui'
import { computed, onBeforeUnmount, provide, ref, shallowRef, watch } from 'vue'

import type { DocumentThread } from '@/apps/drive'
import { writerBinding } from '@/apps/writer/collab/binding'
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
import type { CollabRoom } from '@/platform/collab'

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

const showSettings = defineModel<boolean>('showSettings')
/** The thread open in the comments panel; clicking its highlighted text opens it. */
const openThread = defineModel<string | null>('openThread', { default: null })
const emit = defineEmits<{ comment: [anchor: string]; commentOnDocument: [] }>()

const edited = ref(false)
const textEditor = ref<InstanceType<typeof CoreEditor> | null>(null)

const editor = computed(() => textEditor.value?.editor)
provide('editor', editor)

const presence = props.room.presence
const roster = shallowRef(presence?.peers ?? [])
const stopListening = presence?.onChange(() => {
  roster.value = presence.peers
})
onBeforeUnmount(() => stopListening?.())

const peers = computed(() => {
  const colours = presence && presenceColours(presence)
  return peopleOf(roster.value, colours || new Map())
})
const places = shallowRef<ThreadPlaces>(new Map())
const isFrozen = ref(false)
defineExpose({ editor, peers, places, isFrozen })

function handleFrozen() {
  isFrozen.value = true
}

const extensions = [
  ...writerBinding(props.room, handleFrozen),
  PasteSizeGuard.configure({
    limits: () => props.room.status.limits,
    atLimit: () => props.room.status.isAtLimit,
    onTooLarge: () =>
      toast.error(__('This is too large to add in one go. Add it in smaller parts.')),
    onNearFull: () => toast.warning(__('This document is nearly full. Some changes may not save.')),
  }),
  ThreadHighlights.configure({
    threads: () => props.threads,
    onPlaced: (placed) => {
      places.value = placed
    },
    open: () => openThread.value,
    lit: () => props.litThread ?? null,
    onOpened: (name) => {
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

async function handleSave(_manual: boolean, _html: string | null, done?: () => void) {
  await withinTenSeconds(props.room.flush())
  if (props.room.status.saveState === 'clean') {
    done?.()
  } else if (done) {
    toast.warning(__('Not saved yet. Your changes are kept in this tab.'))
  }
}
</script>
