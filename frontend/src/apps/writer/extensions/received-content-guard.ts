import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import {
  Plugin,
  PluginKey,
  type EditorState,
  type PluginSpec,
  type Transaction,
} from '@tiptap/pm/state'
import { ReplaceAroundStep, type Step, type StepMap } from '@tiptap/pm/transform'
import { ySyncPluginKey } from '@tiptap/y-tiptap'

import { changedRanges, mapRanges, rangesChangedBy, touches, type Range } from './ranges'

const guardKey = new PluginKey<Range[] | null>('receivedContentGuard')

// A change Yjs wrote into the editor: a collaborator's, or this person's undo or redo
export function isReceived(tr: Transaction) {
  return !!tr.getMeta(ySyncPluginKey)?.isChangeOrigin
}

// Swapping only a wrapper sets attributes, which settle to one value in Yjs, so it may follow up anywhere
function settlesToOneValue(step: Step, doc: Node) {
  if (!(step instanceof ReplaceAroundStep)) {
    return false
  }

  const { from, to, gapFrom, gapTo, insert, slice } = step
  const node = slice.content.firstChild
  const isWrapperOnly =
    gapFrom === from + 1 && gapTo === to - 1 && insert === 1 && slice.content.childCount === 1
  const isSameNodeType = node?.type === doc.nodeAt(from)?.type
  return isWrapperOnly && isSameNodeType
}

// Mark and attribute steps move no positions, so they pass anywhere on purpose: Yjs keeps the last
// formatting written, which can't duplicate content, and no normalizer formats outside the change
function staysInside(map: StepMap, ranges: Range[]) {
  let isInside = true
  function checkRange(from: number, to: number) {
    isInside &&= touches(ranges, from, to)
  }

  // A step map is not iterable, so its own forEach
  map.forEach(checkRange)
  return isInside
}

interface GuardStorage {
  rootTransaction: Transaction | null
}

function applyGuard(storage: GuardStorage, tr: Transaction, ranges: Range[] | null) {
  const { rootTransaction } = storage
  if (tr === rootTransaction) {
    const isOwnEdit = rootTransaction.docChanged && !isReceived(rootTransaction)
    if (!isOwnEdit) {
      return null
    }

    return rangesChangedBy(tr)
  }

  if (!rootTransaction || !ranges) {
    return null
  }

  return changedRanges([tr], ranges)
}

function allowsFollowUp(storage: GuardStorage, tr: Transaction, state: EditorState) {
  const { rootTransaction } = storage
  if (!rootTransaction || tr === rootTransaction || !tr.docChanged) {
    return true
  }

  const ranges = guardKey.getState(state)
  if (!ranges) {
    return false
  }

  let allowedRanges = ranges
  for (const [i, step] of tr.steps.entries()) {
    const map = step.getMap()
    if (!settlesToOneValue(step, tr.docs[i]) && !staysInside(map, allowedRanges)) {
      return false
    }

    allowedRanges = mapRanges(allowedRanges, map)
  }

  return true
}

// Every viewer runs the same normalizers, and Yjs keeps each viewer's copy of
// an insert, so normalizers may only follow up the user's own edits, where they made them
export const ReceivedContentGuard = Extension.create<object, GuardStorage>({
  name: 'receivedContentGuard',

  addStorage() {
    return { rootTransaction: null }
  },

  dispatchTransaction({ transaction, next }) {
    this.storage.rootTransaction = transaction
    try {
      next(transaction)
    } finally {
      this.storage.rootTransaction = null
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    const spec: PluginSpec<Range[] | null> = {
      key: guardKey,
      state: {
        init: () => null,
        apply: (tr, ranges) => applyGuard(storage, tr, ranges),
      },
      filterTransaction: (tr, state) => allowsFollowUp(storage, tr, state),
    }

    return [new Plugin(spec)]
  },
})
