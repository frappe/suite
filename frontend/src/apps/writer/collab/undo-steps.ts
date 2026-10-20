import { Extension } from '@tiptap/core'
import type { Fragment } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { ReplaceAroundStep, ReplaceStep, type Step } from '@tiptap/pm/transform'
import { ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap'

function hasBlock(fragment: Fragment) {
  let found = false
  fragment.forEach((node) => {
    found ||= !node.isInline
  })
  return found
}

// A new line, a list indent, a pasted or inserted block
function isBlockStep(step: Step) {
  if (step instanceof ReplaceAroundStep) {
    return true
  }

  return step instanceof ReplaceStep && hasBlock(step.slice.content)
}

function isOwnBlockEdit(transaction: Transaction) {
  const isOwn = transaction.getMeta(ySyncPluginKey) === undefined
  return isOwn && transaction.docChanged && transaction.steps.some(isBlockStep)
}

/** Starts a new undo step at each new block, so Ctrl+Z takes back one line at a time. */
export const UndoSteps = Extension.create<object, { stop: (() => void) | null }>({
  name: 'undoSteps',

  addStorage() {
    return { stop: null }
  },

  onBeforeCreate() {
    const editor = this.editor
    function onBeforeTransaction({ transaction }: { transaction: Transaction }) {
      if (isOwnBlockEdit(transaction)) {
        yUndoPluginKey.getState(editor.state)?.undoManager.stopCapturing()
      }
    }

    editor.on('beforeTransaction', onBeforeTransaction)
    this.storage.stop = () => editor.off('beforeTransaction', onBeforeTransaction)
  },

  onDestroy() {
    this.storage.stop?.()
  },
})
