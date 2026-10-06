<template>
  <div class="flex flex-col w-full bg-surface-base" @keydown.capture="openCommandPalette">
    <TextEditorFixedMenu
      v-if="editable"
      class="w-full max-w-[100vw] py-1.5 !px-4 md:px-0 overflow-x-auto flex shrink-0 border-b border-outline-elevation-2"
      :editor="editor"
      :items="menuButtons"
    />
    <div class="relative flex flex-1 overflow-hidden">
      <ToC v-if="editor" :editor :anchors />
      <div
        id="editor-scroll-container"
        class="relative flex-1 min-w-0 overflow-y-auto overflow-x-hidden md:border-l border-outline-gray-2"
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
              placeholder="Start thinking…"
              :extensions="editorExtensions"
              :editable
              @change="handleEditorChange"
            >
              <template #default="{ editor }">
                <EditorBubbleMenu :editor :items="bubbleMenuButtons" :options="bubbleMenuOpts" />
                <EditorTableMenu :editor />
                <EditorDropZone :editor :disabled="!editable" class="grow flex flex-col">
                  <EditorContent
                    :editor
                    role="textbox"
                    aria-label="Document editor"
                    aria-multiline="true"
                    class="grow w-full bg-surface-base overflow-x-auto pt-10 pb-24 px-5 prose prose-sm prose-v3 prose-table:table-fixed prose-td:p-2 prose-th:p-2 prose-td:border prose-th:border prose-td:relative prose-th:relative prose-th:bg-surface-gray-2"
                    :class="isPainting && 'cursor-crosshair'"
                    :style="editorStyle"
                  />
                </EditorDropZone>
              </template>
            </FTextEditor>
          </div>
          <div class="relative hidden md:block min-w-0">
            <FloatingComments
              v-if="commentsPainted"
              v-model:active-comment="activeComment"
              :y-comments="comments"
              :file
              :show-comments
              :show-resolved
              :show-unanchored
              :editor
              @save="saveComments"
            />
          </div>
        </div>
      </div>
      <div
        v-if="commentsPainted && comments._map.size"
        class="hidden md:block absolute top-4 right-4"
      >
        <Dropdown :options="commentFilterOptions" align="end">
          <Button
            :icon="LucideMessageSquareQuote"
            variant="outline"
            label="Comment visibility"
            tooltip="Comment visibility"
          />
        </Dropdown>
      </div>
    </div>
    <ToCMobile v-if="editor" :editor />
  </div>
</template>

<script setup>
import {
  getHierarchicalIndexes,
  default as TableOfContents,
} from '@tiptap/extension-table-of-contents'
import { CharacterCount, Selection } from '@tiptap/extensions'
import { TextSelection } from '@tiptap/pm/state'
import { onKeyDown } from '@vueuse/core'
import LucideMessageSquareQuote from '~icons/lucide/message-square-quote'
import { Button, Dropdown, toast, useFileUpload } from 'frappe-ui'
import {
  EditorBubbleMenu,
  EditorContent,
  EditorDropZone,
  EditorTableMenu,
  Editor as FTextEditor,
  RichTextKit,
  EditorFixedMenu as TextEditorFixedMenu,
} from 'frappe-ui/editor'
import { v4 as uuidv4 } from 'uuid'
import { computed, inject, onBeforeUnmount, provide, ref, watch } from 'vue'

import { hasDefaultDocumentTitle } from '@/apps/drive'
import { reportSaveError } from '@/apps/writer/composables/saveError'
import { searchMentions, useUsers } from '@/apps/writer/composables/useUsers'
import emitter from '@/apps/writer/emitter'
import CleanStyles from '@/apps/writer/extensions/clean-styles'
import { CommentExtension, rebuild } from '@/apps/writer/extensions/comments'
import { CoreEditorExtension } from '@/apps/writer/extensions/core-editor'
import { DOCUMENT_MEDIA, DriveMedia } from '@/apps/writer/extensions/drive-media'
import { JoinAdjacentLists } from '@/apps/writer/extensions/join-adjacent-lists'
import MediaDownload from '@/apps/writer/extensions/media-download'
import { MentionSearch } from '@/apps/writer/extensions/mention-search'
import OldCommentExtension from '@/apps/writer/extensions/old-comment'
import { PageBreakExtension } from '@/apps/writer/extensions/page-break'
import TabTrailingNode from '@/apps/writer/extensions/tab-trailing-node'
import { TabsExtension } from '@/apps/writer/extensions/tabs'
import { RENAME_DOCUMENT } from '@/apps/writer/renameDocument'
import { COMMON_EXTENSIONS, isModKey, printDoc } from '@/apps/writer/utils'
import { cssLineHeight } from '@/apps/writer/utils/typography'
import { useSessionStore } from '@/boot/session'
import { useRootStore } from '@/stores/root'

import { bubbleMenuOptions } from './core-editor/bubble-menu'
import { buildMenuButtons } from './core-editor/menu-buttons'
import FloatingComments from './FloatingComments.vue'
import ToC from './ToC.vue'
import ToCMobile from './ToCMobile.vue'

const AUTOVERSION_INTERVAL_MS = 10 * 60 * 1000

const props = defineProps({
  file: Object,
  document: Object,
  settings: Object,
  editable: Boolean,
  yjsDoc: { required: false, default: null },
  extensions: { type: Array, default: () => [] },
  comments: Object,
  newComment: Function,
  saveComments: Function,
  rawContent: String,
})
const emit = defineEmits(['save', 'editor-change', 'cleanup'])

const showSettings = defineModel('showSettings')
const edited = defineModel('edited')
const root = useRootStore()

const localContent = ref(props.rawContent ?? '')
watch(
  () => props.rawContent,
  (val) => {
    if (val) localContent.value = val
  },
  { once: true },
)

const textEditor = ref(null)
const editor = computed(() => textEditor.value?.editor)
provide('editor', editor)
defineExpose({ editor })

const anchors = ref([])
const activeComment = ref(null)
const commentsPainted = ref(false)
const showComments = ref(JSON.parse(localStorage.getItem('show-comments') || 'false'))
const showResolved = ref(false)
const showUnanchored = ref(false)

watch(activeComment, () => rebuild(editor.value))
watch(showComments, (val) => localStorage.setItem('show-comments', val))

const scrollParent = computed(() => document.querySelector('#editor-scroll-container'))

// The format painter keeps its flag in plain editor storage, which Vue does
// not track. Read it again after each transaction.
const isPainting = ref(false)
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

const showUnanchoredButton = computed(() => {
  if (!commentsPainted.value) return false
  return Array.from(props.comments._map).some(
    ([, value]) => !document.querySelector(`[data-comment-name='${value.content?.arr?.[0].id}']`),
  )
})

const commentFilterOptions = computed(() => {
  const hasResolved = Array.from(props.comments._map).some(
    ([, value]) => value.content?.arr?.[0].resolved,
  )
  return [
    {
      label: 'Comments',
      switch: true,
      switchValue: showComments.value,
      onClick: () => (showComments.value = !showComments.value),
    },
    hasResolved &&
      showComments.value && {
        label: 'Resolved',
        switch: true,
        switchValue: showResolved.value,
        onClick: () => (showResolved.value = !showResolved.value),
      },
    showUnanchoredButton.value &&
      showComments.value && {
        label: 'Outdated',
        switch: true,
        switchValue: showUnanchored.value,
        onClick: () => (showUnanchored.value = !showUnanchored.value),
      },
  ].filter(Boolean)
})

const onCommentActivated = (id) => {
  if (!id) return
  activeComment.value = id
  showComments.value = true
  const commentEl =
    document.querySelector(`span[data-comment-name="${id}"]`) ||
    document.querySelector(`span[data-comment-id="${id}"]`)
  if (commentEl && !commentEl.offsetParent) {
    commentEl.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest',
    })
  }
}

const hasCollaboration = props.extensions?.some((ext) => ext?.name === 'collaboration')
const { users } = useUsers()
const renameDocument = inject(RENAME_DOCUMENT, null)

const editorExtensions = [
  RichTextKit.configure({
    starterKit: {
      trailingNode: { node: 'paragraph', notAfter: 'tab' },
      paragraph: false,
      gapcursor: false,
      ...(hasCollaboration && { undoRedo: false }),
    },
    mention: { items: () => users.value },
    // The Paint Styles button arms the format painter.
    styleClipboard: {},
  }),
  MentionSearch.configure({ onQuery: searchMentions }),
  ...COMMON_EXTENSIONS,
  CoreEditorExtension,
  PageBreakExtension,
  CharacterCount,
  Selection,
  CleanStyles.configure({
    allowProperty: (_prop, value) => value !== '',
    validators: {
      lineHeight: (value) => !value.endsWith('%'),
      fontFamily: (value) => value.trim() !== '""',
    },
  }),
  TabsExtension,
  TabTrailingNode,
  JoinAdjacentLists,
  OldCommentExtension.configure({ onCommentActivated }),
  TableOfContents.configure({
    onUpdate: (val) => (anchors.value = val),
    getIndex: getHierarchicalIndexes,
    scrollParent: () => scrollParent.value,
  }),
  MediaDownload,
  DriveMedia.configure({ media: inject(DOCUMENT_MEDIA, null) }),
  CommentExtension.configure({
    comments: props.comments,
    doc: props.yjsDoc,
    activeComment,
    showComments,
    showResolved,
    edited,
    onActivated: onCommentActivated,
    onDecorationsPainted: () => (commentsPainted.value = true),
  }),
  ...props.extensions,
]

const menuButtons = computed(() =>
  buildMenuButtons({
    editor,
    settings: props.settings,
    isPainting,
    openSettings: () => (showSettings.value = true),
  }),
)

const bubbleMenuButtons = [
  {
    label: 'Comment',
    icon: 'lucide-message-square-plus',
    action: () => addComment(),
  },
]

const bubbleMenuOpts = computed(() => bubbleMenuOptions({ editor, comments: props.comments }))

const gridStyle = computed(() => ({
  gridTemplateColumns: `minmax(0, 1fr) minmax(0, ${
    props.settings?.wide ? '100ch' : '48rem'
  }) minmax(0, 1fr)`,
}))

const editorStyle = computed(() => ({
  fontFamily: props.settings?.font_family && `var(--font-${props.settings.font_family})`,
  '--editor-font-size': `${props.settings?.font_size || 15}px`,
  '--editor-line-height': cssLineHeight(props.settings?.line_height),
  '--paragraph-spacing-before': `${props.settings?.paragraph_spacing_before || 0}px`,
  '--paragraph-spacing-after': `${props.settings?.paragraph_spacing_after || 0}px`,
}))

const uploadFunction = (file) => {
  const fileUpload = useFileUpload()
  return fileUpload.upload(file, {
    private: false,
    params: { file_id: props.file.doc.name },
    upload_endpoint: `/api/method/suite.writer.api.embed.add`,
  })
}

const onBackgroundClick = (e) => {
  if (e.target.tagName === 'DIV') {
    textEditor.value?.editor?.chain?.().focus?.().run?.()
  }
}

// The owner of `edited` decides what counts as a change: `useYjs` reads the
// Yjs document, `NonCollabEditor` compares the HTML. This event also fires
// when the stored body is first put into the editor, so it marks nothing.
const handleEditorChange = (value) => {
  emit('editor-change', value)
}

const autoversion = async () => {
  if (!edited.value) return
  const html = editor.value.getHTML()?.trim()
  if (!html || html === '<p></p>') return
  await props.document.newVersion.run({ data: html })
}
const autoversionInterval = setInterval(() => {
  void autoversion().catch(reportSaveError)
}, AUTOVERSION_INTERVAL_MS)

const autorename = () => {
  const { $anchor } = editor.value.view.state.selection
  const inFirstBlock = $anchor.index(0) === 1 && $anchor.depth === 1
  if (!inFirstBlock) {
    const inLastLine =
      $anchor.depth === 1 && editor.value.state.doc.childCount - 1 === $anchor.index(0)
    if (inLastLine) {
      scrollParent.value.scroll(0, scrollParent.value.scrollHeight)
    }
    return
  }
  if (!hasDefaultDocumentTitle(props.file.doc.file_name)) return

  const implicitTitle = editor.value.state.doc.firstChild.textContent
    .replaceAll('#', '')
    .replaceAll('@', '')
    .slice(0, 30)
    .trim()
  if (!implicitTitle.length) return

  renameDocument?.(implicitTitle.slice(0, 100)).catch((error) => {
    toast.error(error?.message || 'Could not rename this file.')
  })
}

const addComment = () => {
  if (!props.yjsDoc) {
    return toast.warning("New comments aren't supported on this doc.", {
      duration: 1,
    })
  }
  showComments.value = true
  const { state } = editor.value
  const { from, to } = state.selection
  if (from === to) return

  const id = uuidv4()
  props.newComment(id, from, to, useSessionStore().user, state.doc.textBetween(from, to, ' '))
  activeComment.value = id
  const tr = state.tr.setSelection(TextSelection.create(state.doc, from))
  editor.value.view.dispatch(tr)
}

const manualSave = (func) => emit('save', true, null, func)

const openCommandPalette = (event) => {
  if (
    !props.editable ||
    (!event.metaKey && !event.ctrlKey) ||
    event.shiftKey ||
    event.altKey ||
    event.key.toLowerCase() !== 'k'
  )
    return
  event.preventDefault()
  event.stopPropagation()
  root.paletteOpen = true
}

onKeyDown('p', (e) => {
  if (!isModKey(e)) return
  e.preventDefault()
  emitter.emit('print-file')
})

onKeyDown('s', (e) => {
  if (!props.editable || !isModKey(e) || e.shiftKey) return
  e.preventDefault()
  manualSave(() => toast.success('Saved document'))
})

onKeyDown('Enter', autorename)

emitter.on('print-file', () => {
  if (editor.value) {
    printDoc(editor.value.commands.getCurrentTabHTML(), props.settings)
  }
})
emitter.on('manual-save', manualSave)

onBeforeUnmount(() => {
  if (edited.value) {
    emit('save', false, editor.value.getHTML())
  }
  clearInterval(autoversionInterval)
  emitter.off('print-file')
  emitter.off('manual-save')
  emit('cleanup')
})
</script>

<style>
@import url('@/apps/writer/styles/editor.css');

iframe {
  border: 1px solid var(--surface-gray-4) !important;
}
</style>
