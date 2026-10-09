import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, type PluginSpec, type Transaction } from '@tiptap/pm/state'
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceAroundStep,
  type Mappable,
  type Step,
} from '@tiptap/pm/transform'
import { ySyncPluginKey } from '@tiptap/y-tiptap'

type Range = [number, number]

const guardKey = new PluginKey<Range[] | null>('receivedContentGuard')

function rangesChangedBy(tr: Transaction) {
  const ranges: Range[] = []
  const collectStepRanges = (step: Step, i: number) => {
    const laterMapping = tr.mapping.slice(i + 1)
    const addRange = (_from: number, _to: number, from: number, to: number) => {
      ranges.push([laterMapping.map(from, -1), laterMapping.map(to, 1)])
    }
    step.getMap().forEach(addRange)
  }
  tr.steps.forEach(collectStepRanges)

  return ranges
}

const mapRanges = (ranges: Range[], mapping: Mappable) =>
  ranges.map(([from, to]): Range => [mapping.map(from, -1), mapping.map(to, 1)])

// Where `transactions` changed the document, in the last one's positions.
// Normalizers fix only there, or the guard refuses their whole transaction
export const changedRanges = (transactions: readonly Transaction[], ranges: Range[] = []) =>
  transactions.reduce(
    (rangesSoFar, tr) => [...mapRanges(rangesSoFar, tr.mapping), ...rangesChangedBy(tr)],
    ranges,
  )

export const touches = (ranges: Range[], from: number, to = from) =>
  ranges.some(([start, end]) => from <= end && start <= to)

// Attributes and marks settle to one value in Yjs, so these may follow up anywhere
function settlesToOneValue(step: Step, doc: Node) {
  const setsAttrOrMark =
    step instanceof AttrStep ||
    step instanceof AddMarkStep ||
    step instanceof RemoveMarkStep ||
    step instanceof AddNodeMarkStep ||
    step instanceof RemoveNodeMarkStep
  if (setsAttrOrMark) {
    return true
  }

  if (!(step instanceof ReplaceAroundStep)) return false

  const { from, to, gapFrom, gapTo, insert, slice } = step
  const node = slice.content.firstChild
  const replacesOnlyWrapper =
    gapFrom === from + 1 && gapTo === to - 1 && insert === 1 && slice.content.childCount === 1
  const keepsNodeType = node?.type === doc.nodeAt(from)?.type
  return replacesOnlyWrapper && keepsNodeType
}

// Every viewer runs the same normalizers, and Yjs keeps each viewer's copy of
// an insert, so normalizers may only follow up the user's own edits, where they made them.
export const ReceivedContentGuard = Extension.create<
  object,
  { rootTransaction: Transaction | null }
>({
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
        apply: (tr, ranges) => {
          const { rootTransaction } = storage
          if (tr === rootTransaction) {
            const isOwnEdit =
              rootTransaction.docChanged && !rootTransaction.getMeta(ySyncPluginKey)?.isChangeOrigin
            if (!isOwnEdit) return null

            return rangesChangedBy(tr)
          }

          if (!rootTransaction || !ranges) return null

          return changedRanges([tr], ranges)
        },
      },
      filterTransaction: (tr, state) => {
        const { rootTransaction } = storage
        if (!rootTransaction || tr === rootTransaction || !tr.docChanged) return true

        const ranges = guardKey.getState(state)
        if (!ranges) return false

        const staysInside = (step: Step, i: number) => {
          if (settlesToOneValue(step, tr.docs[i])) return true

          const mappingBefore = tr.mapping.slice(0, i)
          const allowedRanges = mapRanges(ranges, mappingBefore)
          let isInside = true
          const checkRange = (from: number, to: number) => {
            isInside &&= touches(allowedRanges, from, to)
          }
          step.getMap().forEach(checkRange)
          return isInside
        }

        return tr.steps.every(staysInside)
      },
    }

    return [new Plugin(spec)]
  },
})
