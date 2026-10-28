<template>
  <div class="flex flex-col w-full bg-surface-base">
    <slot name="toolbar">
      <WriterToolbar v-if="editable && editor" :editor :settings :is-painting />
    </slot>
    <div class="flex flex-1 overflow-hidden">
      <ToC v-if="editor" :editor :anchors :class="hasCover() && 'invisible'" />
      <div class="relative flex flex-1 min-w-0">
        <div
          v-show="!hasCover()"
          id="editor-scroll-container"
          class="relative flex-1 min-w-0 overflow-y-auto overflow-x-hidden md:border-l border-outline-gray-1"
        >
          <div
            class="min-h-full flex flex-col md:grid md:grid-rows-[1fr]"
            :style="gridStyle"
            @click="onBackgroundClick"
          >
            <div class="hidden md:block" />
            <div class="flex flex-col grow min-w-0">
              <FTextEditor
                ref="textEditor"
                v-model="localContent"
                :upload-function="uploadFunction"
                :autofocus="true"
                :placeholder="__('Type / for blocks, @ to mention…')"
                :extensions="editorExtensions"
                :editable
                @change="handleEditorChange"
              >
                <template #default="{ editor }">
                  <WriterBubbleMenu
                    v-if="editor"
                    :editor
                    :should-show="shouldShowBubbleMenu"
                    @comment="addComment"
                  />
                  <LinkPopover v-if="editor && editable" :editor />
                  <TableControls v-if="editor && editable" :editor />
                  <EditorDropZone :editor :disabled="isReadOnly" class="grow flex flex-col">
                    <EditorContent
                      :editor
                      role="textbox"
                      :aria-label="__('Document editor')"
                      aria-multiline="true"
                      :class="editorClass"
                      :style="editorStyle"
                    />
                  </EditorDropZone>
                </template>
              </FTextEditor>
            </div>
            <div class="hidden md:block" />
          </div>
        </div>
        <slot name="cover" />
      </div>
      <slot name="aside" />
    </div>
    <ToCMobile v-if="editor && !hasCover()" :editor />
  </div>
</template>

<script setup lang="ts">
import type { AnyExtension, Content } from '@tiptap/core'
import { onKeyDown } from '@vueuse/core'
import { toast } from 'frappe-ui'
import { EditorContent, EditorDropZone, Editor as FTextEditor } from 'frappe-ui/editor'
import {
  computed,
  inject,
  onBeforeUnmount,
  provide,
  ref,
  useSlots,
  useTemplateRef,
  watch,
} from 'vue'

import { hasDefaultDocumentTitle, useDriveDialogs } from '@/apps/drive'
import { useUsers } from '@/apps/writer/composables/useUsers'
import { uploadMedia } from '@/apps/writer/drive'
import { writerEditorExtensions } from '@/apps/writer/editor-extensions'
import emitter from '@/apps/writer/emitter'
import { DOCUMENT_MEDIA } from '@/apps/writer/extensions/drive-media'
import { currentTabHTML } from '@/apps/writer/extensions/tabs'
import { RENAME_DOCUMENT } from '@/apps/writer/renameDocument'
import type {
  EditorFile,
  WriterDocument,
  WriterSettings,
} from '@/apps/writer/surface/writerDocument'
import { isModKey, printDoc } from '@/apps/writer/utils'
import {
  EDITOR_TEXT_CLASS,
  editorColumns,
  editorTextStyle,
} from '@/apps/writer/utils/editor-layout'

import { bubbleMenuShouldShow } from './core-editor/bubble-menu'
import LinkPopover from './core-editor/LinkPopover.vue'
import TableControls from './core-editor/table/TableControls.vue'
import WriterBubbleMenu from './core-editor/WriterBubbleMenu.vue'
import WriterToolbar from './core-editor/WriterToolbar.vue'
import ToC from './ToC.vue'
import ToCMobile from './ToCMobile.vue'

const props = withDefaults(
  defineProps<{
    file: EditorFile
    document: WriterDocument
    settings: WriterSettings
    editable?: boolean
    collaborative?: boolean
    extensions?: AnyExtension[]
    rawContent?: string
    // Takes over the bubble menu's Comment, for editors that comment through Drive
    commentOnSelection?: (() => void) | null
  }>(),
  { extensions: () => [], commentOnSelection: null },
)

const emit = defineEmits<{
  save: [manual: boolean, html: string | null, done?: () => void]
  'editor-change': [value: Content]
  cleanup: []
}>()

const edited = defineModel<boolean>('edited')
const slots = useSlots()

function hasCover() {
  return !!slots.cover
}

const localContent = ref(props.rawContent ?? '')

watch(
  () => props.rawContent,
  (val) => {
    if (val) localContent.value = val
  },
  { once: true },
)

const textEditor = useTemplateRef('textEditor')
const editor = computed(() => textEditor.value?.editor)
provide('editor', editor)
defineExpose({ editor })

const anchors = ref<unknown[]>([])

const scrollParent = computed(() => document.querySelector<HTMLElement>('#editor-scroll-container'))

// The format painter keeps its flag in plain editor storage, which Vue does
// not track. Read it again after each transaction.
const isPainting = ref(false)
const editorClass = computed(() => [EDITOR_TEXT_CLASS, isPainting.value && 'cursor-crosshair'])
const isReadOnly = computed(() => !props.editable)

watch(
  editor,
  (instance, _previous, onCleanup) => {
    if (!instance) return
    const read = () => (isPainting.value = !!instance.storage.styleClipboard?.painting)
    instance.on('transaction', read)
    onCleanup(() => instance.off('transaction', read))
  },
  { immediate: true },
)

function onCommentActivated(id: string) {
  if (!id) return
  const commentEl =
    document.querySelector<HTMLElement>(`span[data-comment-name="${id}"]`) ||
    document.querySelector<HTMLElement>(`span[data-comment-id="${id}"]`)
  if (commentEl && !commentEl.offsetParent) {
    commentEl.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest',
    })
  }
}

// Ranks the `@` menu for this document and loads its first page
useUsers()
const renameDocument = inject(RENAME_DOCUMENT, null)

const driveDialogs = useDriveDialogs()
const writerEditorOptions = {
  isCollaborative: props.collaborative,
  onCommentActivated,
  onAnchors: (found: unknown[]) => {
    anchors.value = found
  },
  scrollParent: () => scrollParent.value!,
  media: inject(DOCUMENT_MEDIA, null),
  pickDriveFile: () =>
    driveDialogs.pickFile({ title: __('Insert from Drive'), action: __('Insert') }),
}

const editorExtensions = [...writerEditorExtensions(writerEditorOptions), ...props.extensions]

const shouldShowBubbleMenu = bubbleMenuShouldShow()

const gridStyle = computed(() => editorColumns(props.settings))

const editorStyle = computed(() => editorTextStyle(props.settings))

function uploadFunction(file: File, options?: Parameters<typeof uploadMedia>[2]) {
  return uploadMedia(props.file.doc.name, file, options)
}

function onBackgroundClick(event: MouseEvent) {
  if (event.target instanceof HTMLElement && event.target.tagName === 'DIV') {
    textEditor.value?.editor?.chain?.().focus?.().run?.()
  }
}

// The owner of `edited` decides what counts as a change. This event also fires
// when the stored body is first put into the editor, so it marks nothing.
function handleEditorChange(value: Content) {
  emit('editor-change', value)
}

function autorename() {
  const instance = editor.value
  if (!instance) return

  const { $anchor } = instance.view.state.selection
  const inFirstBlock = $anchor.index(0) === 1 && $anchor.depth === 1
  if (!inFirstBlock) {
    const isInLastLine =
      $anchor.depth === 1 && instance.state.doc.childCount - 1 === $anchor.index(0)
    if (isInLastLine) {
      scrollParent.value!.scroll(0, scrollParent.value!.scrollHeight)
    }
    return
  }
  if (!hasDefaultDocumentTitle(props.file.doc.file_name)) return

  const implicitTitle = instance.state.doc
    .firstChild!.textContent.replaceAll('#', '')
    .replaceAll('@', '')
    .slice(0, 30)
    .trim()
  if (!implicitTitle.length) return

  renameDocument?.(implicitTitle.slice(0, 100)).catch((error) => {
    toast.error(error?.message || __('Could not rename this file.'))
  })
}

function addComment() {
  if (props.commentOnSelection) {
    return props.commentOnSelection()
  }

  toast.warning(__("New comments aren't supported on this doc."), { duration: 1 })
}

function manualSave(func?: () => void) {
  emit('save', true, null, func)
}

onKeyDown('p', (e) => {
  if (!isModKey(e)) return
  e.preventDefault()
  emitter.emit('print-file')
})

onKeyDown('s', (e) => {
  if (!props.editable || !isModKey(e) || e.shiftKey) return
  e.preventDefault()
  manualSave(() => toast.success(__('Saved document')))
})

onKeyDown('Enter', autorename)

emitter.on('print-file', () => {
  if (editor.value) {
    printDoc(currentTabHTML(editor.value), props.settings)
  }
})

onBeforeUnmount(() => {
  const instance = editor.value
  if (edited.value && instance) {
    emit('save', false, instance.getHTML())
  }
  emitter.off('print-file')
  emit('cleanup')
})
</script>

<style>
@import url('@/apps/writer/styles/editor.css');

iframe {
  border: 1px solid var(--surface-gray-4) !important;
}
</style>
