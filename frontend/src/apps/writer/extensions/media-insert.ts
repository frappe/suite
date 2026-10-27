import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'

import { selectEmptyLineAfter } from '@/apps/writer/extensions/empty-line-after'
import { isReceived } from '@/apps/writer/extensions/received-content-guard'

const MEDIA = new Set(['image', 'video'])

/**
 * Makes putting in a picture or video one step, as typing sees it and as undo sees it:
 * - The caret goes to an empty line after a video, which frappe-ui leaves selected,
 *   so the next key does not replace it.
 * - The upload writing its result into the placeholder stays out of undo, so one
 *   undo removes the whole video instead of bringing back an empty "0%" box.
 */
export const MediaInsert = Extension.create({
  name: 'mediaInsert',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('mediaInsert'),
        // The only hook that runs before undo history reads the transaction.
        filterTransaction: (tr) => {
          if (isUploadWriteBack(tr)) tr.setMeta('addToHistory', false)
          return true
        },
        appendTransaction: (transactions, _before, state) => {
          const { selection } = state
          if (!(selection instanceof NodeSelection) || !selection.node.isBlock) return null
          if (!transactions.some((tr) => insertsNode(tr, selection.node))) return null
          return selectEmptyLineAfter(state.tr, selection.to)
        },
      }),
    ]
  },
})

/** True when every step swaps an uploading picture or video for its finished or failed self. */
function isUploadWriteBack(tr: Transaction): boolean {
  return (
    tr.docChanged &&
    !isReceived(tr) &&
    tr.steps.every((step, index) => {
      if (!(step instanceof ReplaceStep) || step.slice.content.childCount !== 1) return false
      const before = tr.docs[index].nodeAt(step.from)
      const after = step.slice.content.firstChild
      if (!before || !after || !MEDIA.has(before.type.name)) return false
      const isSameUpload =
        after.type === before.type && after.attrs.uploadId === before.attrs.uploadId
      return (
        before.attrs.loading === true && isSameUpload && step.to === step.from + before.nodeSize
      )
    })
  )
}

/** True when a local edit, not undo or an upload finishing, put in `node`. */
function insertsNode(tr: Transaction, node: Node): boolean {
  const isUndo = tr.getMeta('history$') !== undefined
  if (!tr.docChanged || isReceived(tr) || isUndo || isUploadWriteBack(tr)) return false
  return tr.steps.some((step) => {
    if (!(step instanceof ReplaceStep)) return false
    let isFound = false
    step.slice.content.descendants((child) => {
      isFound ||= child.eq(node)
      return !isFound
    })
    return isFound
  })
}
