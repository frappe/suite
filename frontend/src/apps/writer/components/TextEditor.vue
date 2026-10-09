<template>
  <CoreEditor
    ref="textEditor"
    v-model:show-settings="showSettings"
    v-model:edited="edited"
    v-bind="{ ...props, ...commentsDetail }"
    :yjs-doc="doc"
    :extensions
    @save="
      (manual = false, html, func) => {
        save(manual, html).then(func).catch(reportSaveError)
      }
    "
    @cleanup="cleanup"
  >
    <template v-for="(_, name) in $slots" #[name]>
      <slot :name="name" />
    </template>
  </CoreEditor>
</template>

<script setup>
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { computed, onMounted, provide, ref, watch } from 'vue'

import { reportSaveError } from '@/apps/writer/composables/saveError'
import { useYjs } from '@/apps/writer/composables/useYjs'
import { rebuild } from '@/apps/writer/extensions/comments'
import { getRandomColor } from '@/apps/writer/utils'
import { useCurrentUser } from '@/boot/session'

import CoreEditor from './CoreEditor.vue'

const { user: _sessionUser, fullName: _fullName, imageURL: _imageURL } = useCurrentUser()

const activeComment = ref(null)
const showSettings = defineModel('showSettings')

watch(activeComment, () => rebuild(editor.value))
const edited = defineModel('dirty', { default: false })

const props = defineProps({
  document: Object,
  file: Object,
  settings: Object,
  editable: Boolean,
})

const emit = defineEmits(['saveComment'])

const textEditor = ref('textEditor')

const editor = computed(() => {
  const editor = textEditor.value?.editor
  return editor
})

provide('editor', editor)

// `useYjs` owns the unsaved flag: it sets `edited` on each change to store
// and clears it when a save lands (`composables/unsaved.ts`).
const { doc, save, cleanup, provider, loaded, peers, ...commentsDetail } = useYjs(
  props.file.doc.name,
  props.document,
  editor,
  edited,
)

defineExpose({ editor, peers })
watch(loaded, () => rebuild(editor.value))

const extensions = [
  Collaboration.configure({
    document: doc,
    field: 'default',
  }),
  CollaborationCaret.configure({
    provider,
    selectionRender: () => {},
    user: {
      name: _fullName.value,
      id: _sessionUser.value,
      avatar: _imageURL.value,
      color: getRandomColor(),
    },
  }),
]

// Events
onMounted(() => {
  const { view, state } = editor.value
  view.dispatch(state.tr)
})
</script>
