import { Editor, Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { toast } from 'frappe-ui'
import { setPlaceholder } from 'frappe-ui/editor'
import { shallowRef } from 'vue'

import { writerEditorExtensions } from '@/apps/writer/editor-extensions'
import { EDITOR_TEXT_CLASS, editorTextStyle } from '@/apps/writer/utils/editor-layout'
import { translate as __ } from '@/platform/translation'

interface Opening {
  node: string
  editor: Editor
  element: HTMLElement
}

/** The editor a document just created shows while it opens; one at a time. */
const opening = shallowRef<Opening | null>(null)

/** Whether `node` still shows its opening editor, which its own editor has not taken over. */
export function isOpening(node: string): boolean {
  return opening.value?.node === node
}

/**
 * Puts the opening editor of `node` in `place` and gives it focus. The first
 * call makes it; later calls move the same editor, so what was typed and the
 * caret stay.
 */
export function placeOpeningEditor(node: string, place: HTMLElement): void {
  if (opening.value?.node !== node) {
    closeOpeningEditor()
    opening.value = createOpening(node)
  }
  const { editor, element } = opening.value!
  place.append(element)
  editor.view.focus()
}

/** Closes the opening editor of `node` once no page shows it. */
export function releaseOpeningEditor(node: string): void {
  // A page that takes it over mounts in the same render, before this runs.
  queueMicrotask(() => {
    if (opening.value?.node === node && !opening.value.element.isConnected) closeOpeningEditor()
  })
}

export function closeOpeningEditor(): void {
  opening.value?.editor.destroy()
  opening.value = null
}

/**
 * Moves what was typed in the opening editor of `node` into `editor`, the
 * document's own editor, with the caret where it was, and focuses it. Text
 * the document already holds stays first.
 */
export function handOverOpeningEditor(node: string, editor: Editor): void {
  const current = opening.value
  if (current?.node !== node) return
  const typed = current.editor
  opening.value = null
  if (!typed.isEmpty) {
    if (editor.isEditable) moveTyped(typed, editor)
    else toast.error(__('This document does not take edits, so what you typed was not added.'))
  }
  typed.destroy()
  editor.view.focus()
}

function moveTyped(typed: Editor, editor: Editor) {
  const start = editor.isEmpty ? 0 : editor.state.doc.content.size
  const content = typed.getJSON().content ?? []
  if (start === 0) editor.commands.setContent(content)
  else editor.commands.insertContentAt(start, content)
  const { doc } = editor.state
  const { anchor, head } = typed.state.selection
  const at = (position: number) => doc.resolve(Math.min(start + position, doc.content.size))
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.between(at(anchor), at(head))))
}

function createOpening(node: string): Opening {
  const element = document.createElement('div')
  element.className = 'relative grow flex flex-col'
  const editor = new Editor({
    element,
    extensions: writerEditorExtensions({
      isCollaborative: false,
      onCommentActivated: () => {},
      onAnchors: () => {},
      scrollParent: () => element.parentElement ?? window,
      media: null,
    }),
    editorProps: {
      attributes: {
        class: `prose max-w-none ${EDITOR_TEXT_CLASS}`,
        style: styleText(editorTextStyle()),
        role: 'textbox',
        'aria-label': __('Document editor'),
        'aria-multiline': 'true',
      },
    },
  })
  setPlaceholder(editor, __('Type / for blocks, @ to mention…'))
  return { node, editor, element }
}

function styleText(style: Record<string, string | number | undefined>): string {
  return Object.entries(style)
    .filter(([, value]) => value !== undefined)
    .map(
      ([property, value]) =>
        `${property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value}`,
    )
    .join('; ')
}

/** Takes over the opening editor of `node` once the document's own editor is ready. */
export const OpeningHandover = Extension.create<{ node: string }>({
  name: 'openingHandover',

  addOptions() {
    return { node: '' }
  },

  onCreate() {
    handOverOpeningEditor(this.options.node, this.editor)
  },
})
