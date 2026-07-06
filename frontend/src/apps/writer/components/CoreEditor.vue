<template>
  <div class="flex flex-col w-full bg-surface-base">
    <TextEditorFixedMenu v-if="editable"
      class="w-full max-w-[100vw] py-1.5 !px-4 md:px-0 overflow-x-auto flex shrink-0 border-b border-outline-elevation-2"
      :editor="editor" :items="menuButtons" />
    <div class="flex flex-1 overflow-auto">
      <ToC v-if="editor" :editor :anchors />
      <div id="editor-scroll-container" class="flex w-full overflow-y-auto relative">
        <div class="h-full flex flex-col flex-grow min-h-full" @click="onBackgroundClick" @keydown="onEditorKeydown">
          <FTextEditor ref="textEditor" :upload-function="uploadFunction"
            :autofocus="true" v-model="localContent" placeholder="Start thinking..." :extensions="editorExtensions"
            :editable @change="(val) => emit('editor-change', val)">
            <template #default="{ editor }">
              <EditorBubbleMenu :editor :items="bubbleMenuButtons" :options="bubbleMenuOpts" />
              <EditorTableMenu :editor />
              <EditorDropZone :editor :disabled="!editable">
                <EditorContent :editor
                  class="md:mx-auto bg-surface-base overflow-x-auto pt-10 pb-24 px-5 prose prose-sm prose-v3 prose-table:table-fixed prose-td:p-2 prose-th:p-2 prose-td:border prose-th:border prose-td:relative prose-th:relative prose-th:bg-surface-gray-2"
                  :class="[
                    settings?.wide
                      ? 'md:min-w-[100ch] md:max-w-[100ch]'
                      : 'md:min-w-[48rem] md:max-w-[48rem]',
                    isPainting && 'cursor-crosshair',
                  ]" :style="editorStyle" />
              </EditorDropZone>
            </template>
          </FTextEditor>
        </div>

        <FloatingComments v-if="commentsPainted" v-model:active-comment="activeComment" :y-comments="comments" :file
          :show-comments :show-resolved :show-unanchored :editor @save="saveComments">
          <div v-if="comments._map.size" class="sticky self-end top-4 right-4 z-10">
            <Dropdown :options="commentFilterOptions" placement="right">
              <Button :icon="LucideMessageSquareQuote" variant="outline" />
            </Dropdown>
          </div>
        </FloatingComments>

        <div v-if="!commentsPainted" class="w-72" />
      </div>
    </div>
    <ToCMobile v-if="editor" :editor />
  </div>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
  watch,
} from 'vue'
import { TextSelection } from '@tiptap/pm/state'
import { CharacterCount, Selection } from '@tiptap/extensions'
import {
  default as TableOfContents,
  getHierarchicalIndexes,
} from '@tiptap/extension-table-of-contents'
import {
  Editor as FTextEditor,
  EditorFixedMenu as TextEditorFixedMenu,
  EditorBubbleMenu,
  EditorTableMenu,
  EditorDropZone,
  EditorContent,
  RichTextKit,
} from 'frappe-ui/editor'
import { Button, toast, useFileUpload, Dropdown } from 'frappe-ui'
import { rename, allUsers } from '@/apps/drive/ui/drive/js/resources'
import { onKeyDown } from '@vueuse/core'
import { v4 as uuidv4 } from 'uuid'

import FloatingComments from './FloatingComments.vue'
import ToC from './ToC.vue'
import ToCMobile from './ToCMobile.vue'
import { buildMenuButtons } from './core-editor/menu-buttons'
import { bubbleMenuOptions } from './core-editor/bubble-menu'

import { CoreEditorExtension } from '@/apps/writer/extensions/core-editor'
import { PageBreakExtension } from '@/apps/writer/extensions/page-break'
import CleanStyles from '@/apps/writer/extensions/clean-styles'
import MediaDownload from '@/apps/writer/extensions/media-download'
import OldCommentExtension from '@/apps/writer/extensions/old-comment'
import { TabsExtension } from '@/apps/writer/extensions/tabs'
import TabTrailingNode from '@/apps/writer/extensions/tab-trailing-node'
import { CommentExtension, rebuild } from '@/apps/writer/extensions/comments'


import { useSessionStore } from '@/boot/session'
import emitter from '@/apps/writer/emitter'
import {
  COMMON_EXTENSIONS,
  isModKey,
  printDoc,
  updateURLSlug,
} from '@/apps/writer/utils'

import LucideMessageSquareQuote from '~icons/lucide/message-square-quote'

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

const localContent = ref(props.rawContent ?? '')
watch(
  () => props.rawContent,
  (val) => { if (val) localContent.value = val },
  { once: true },
)

const textEditor = ref(null)
const editor = computed(() => textEditor.value?.editor)
provide('editor', editor)
defineExpose({ editor })

const anchors = ref([])
const activeComment = ref(null)
const commentsPainted = ref(false)
const showComments = ref(
  JSON.parse(localStorage.getItem('show-comments') || 'false'),
)
const showResolved = ref(false)
const showUnanchored = ref(false)

watch(activeComment, () => rebuild(editor.value))
watch(showComments, (val) => localStorage.setItem('show-comments', val))

const scrollParent = computed(() =>
  document.querySelector('#editor-scroll-container'),
)

const isPainting = computed(
  () => !!editor.value?.storage.styleClipboard.styleClipboard,
)

const showUnanchoredButton = computed(() => {
  if (!commentsPainted.value) return false
  return Array.from(props.comments._map).some(
    ([, value]) =>
      !document.querySelector(
        `[data-comment-name='${value.content?.arr?.[0].id}']`,
      ),
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

const editorExtensions = [
  RichTextKit.configure({
    starterKit: {
      trailingNode: { node: 'paragraph', notAfter: 'tab' },
      paragraph: false,
      gapcursor: false,
      ...(hasCollaboration && { undoRedo: false }),
    },
    mention: { items: () => allUsers.data ?? [] },
  }),
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
  OldCommentExtension.configure({ onCommentActivated }),
  TableOfContents.configure({
    onUpdate: (val) => (anchors.value = val),
    getIndex: getHierarchicalIndexes,
    scrollParent: () => scrollParent.value,
  }),
  MediaDownload,
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

const bubbleMenuOpts = computed(() =>
  bubbleMenuOptions({ editor, comments: props.comments }),
)

const editorStyle = computed(() => ({
  fontFamily:
    props.settings?.font_family && `var(--font-${props.settings.font_family})`,
  '--editor-font-size': `${props.settings?.font_size || 15}px`,
  '--editor-line-height': props.settings?.line_height || 1.5,
  '--paragraph-spacing-before': `${props.settings?.paragraph_spacing_before || 0}px`,
  '--paragraph-spacing-after': `${props.settings?.paragraph_spacing_after || 0}px`,
}))

const uploadFunction = (file) => {
  const fileUpload = useFileUpload()
  return fileUpload.upload(file, {
    params: { file_id: props.file.doc.name },
    upload_endpoint: `/api/method/suite.writer.api.embed.add`,
  })
}

const onBackgroundClick = (e) => {
  if (e.target.tagName === 'DIV') {
    textEditor.value?.editor?.chain?.().focus?.().run?.()
  }
}

const onEditorKeydown = async (e) => {
  if (!props.editable || e.metaKey || e.ctrlKey || edited.value) return
  edited.value = true
  await nextTick()
  autoversion()
}

const autoversion = async () => {
  if (!edited.value) return
  const html = editor.value.getHTML()?.trim()
  if (!html || html === '<p></p>') return
  await props.document.newVersion.submit({ data: html })
  const err = props.document.newVersion.error
  if (err && err !== 'Client is offline') {
    toast.error('Something has gone wrong - please contact support.')
  }
}
const autoversionInterval = setInterval(autoversion, AUTOVERSION_INTERVAL_MS)

const autorename = () => {
  const { $anchor } = editor.value.view.state.selection
  const inFirstBlock = $anchor.index(0) === 1 && $anchor.depth === 1
  if (!inFirstBlock) {
    const inLastLine =
      $anchor.depth === 1 &&
      editor.value.state.doc.childCount - 1 === $anchor.index(0)
    if (inLastLine) {
      scrollParent.value.scroll(0, scrollParent.value.scrollHeight)
    }
    return
  }
  if (!props.file.doc.file_name.startsWith('Untitled Document')) return

  const implicitTitle = editor.value.state.doc.firstChild.textContent
    .replaceAll('#', '')
    .replaceAll('@', '')
    .slice(0, 30)
    .trim()
  if (!implicitTitle.length) return

  rename.submit(
    {
      entity_name: props.file.doc.name,
      new_title: implicitTitle.slice(0, 100),
    },
    {
      onSuccess: () => {
        props.file.doc.file_name = rename.params.new_title
        const crumbs = props.file.doc.breadcrumbs
        crumbs[crumbs.length - 1].file_name = rename.params.new_title
        updateURLSlug(rename.params.new_title)
      },
    },
  )
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
  props.newComment(
    id,
    from,
    to,
    useSessionStore().user,
    state.doc.textBetween(from, to, ' '),
  )
  activeComment.value = id
  const tr = state.tr.setSelection(TextSelection.create(state.doc, from))
  editor.value.view.dispatch(tr)
}

const manualSave = (func) => emit('save', true, null, func)

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

.prose-v3 p+p {
  margin-top: var(--paragraph-spacing-before, 0);
}

.prose-v3 p {
  margin-bottom: var(--paragraph-spacing-after, 0);
}
</style>
