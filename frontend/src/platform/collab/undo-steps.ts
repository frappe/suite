import { Extension } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { ReplaceAroundStep, ReplaceStep, type Step } from '@tiptap/pm/transform'
import { ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap'

// A new line, a list indent, a pasted or inserted block
function isBlockStep(step: Step) {
  return (
    step instanceof ReplaceAroundStep ||
    (step instanceof ReplaceStep && step.slice.content.content.some((node) => !node.isInline))
  )
}

function isOwnBlockEdit(transaction: Transaction) {
  const isOwn = transaction.getMeta(ySyncPluginKey) === undefined
  return isOwn && transaction.docChanged && transaction.steps.some(isBlockStep)
}

/** Starts a new undo step at each new block, so Ctrl+Z takes back one line at a time. */
export const UndoSteps = Extension.create({
  name: 'undoSteps',

  dispatchTransaction({ transaction, next }) {
    if (isOwnBlockEdit(transaction)) {
      yUndoPluginKey.getState(this.editor.state)?.undoManager.stopCapturing()
    }

    next(transaction)
  },
})
