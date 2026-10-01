import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
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

const key = new PluginKey<Range[] | null>('receivedContentGuard')

function touched(tr: Transaction) {
  const ranges: Range[] = []
  tr.steps.forEach((step, i) => {
    const after = tr.mapping.slice(i + 1)
    step.getMap().forEach((_from, _to, from, to) => ranges.push([after.map(from, -1), after.map(to, 1)]))
  })
  return ranges
}

const mapRanges = (ranges: Range[], mapping: Mappable) =>
  ranges.map(([from, to]): Range => [mapping.map(from, -1), mapping.map(to, 1)])

// Where `transactions` changed the document, in the last one's positions.
// Normalizers fix only there, or the guard refuses their whole transaction
export const changedRanges = (transactions: readonly Transaction[], ranges: Range[] = []) =>
  transactions.reduce((all, tr) => [...mapRanges(all, tr.mapping), ...touched(tr)], ranges)

export const touches = (ranges: Range[], from: number, to = from) =>
  ranges.some(([start, end]) => from <= end && start <= to)

// Attributes and marks settle to one value in Yjs, so these may follow up anywhere
function settlesToOneValue(step: Step, doc: Node) {
  if (
    step instanceof AttrStep ||
    step instanceof AddMarkStep ||
    step instanceof RemoveMarkStep ||
    step instanceof AddNodeMarkStep ||
    step instanceof RemoveNodeMarkStep
  )
    return true
  if (!(step instanceof ReplaceAroundStep)) return false
  const { from, to, gapFrom, gapTo, insert, slice } = step
  const node = slice.content.firstChild
  return (
    gapFrom === from + 1 &&
    gapTo === to - 1 &&
    insert === 1 &&
    slice.content.childCount === 1 &&
    node?.type === doc.nodeAt(from)?.type
  )
}

// Every viewer runs the same normalizers, and Yjs keeps each viewer's copy of
// an insert, so normalizers may only follow up the user's own edits, where they made them.
export const ReceivedContentGuard = Extension.create<object, { root: Transaction | null }>({
  name: 'receivedContentGuard',

  addStorage() {
    return { root: null }
  },

  dispatchTransaction({ transaction, next }) {
    this.storage.root = transaction
    try {
      next(transaction)
    } finally {
      this.storage.root = null
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin<Range[] | null>({
        key,
        state: {
          init: () => null,
          apply: (tr, ranges) => {
            const { root } = storage
            if (tr === root) return root.docChanged && !root.getMeta(ySyncPluginKey)?.isChangeOrigin ? touched(tr) : null
            if (!root || !ranges) return null
            return changedRanges([tr], ranges)
          },
        },
        filterTransaction: (tr, state) => {
          const { root } = storage
          if (!root || tr === root || !tr.docChanged) return true
          const ranges = key.getState(state)
          if (!ranges) return false
          return tr.steps.every((step, i) => {
            if (settlesToOneValue(step, tr.docs[i])) return true
            const allowed = mapRanges(ranges, tr.mapping.slice(0, i))
            let inside = true
            step.getMap().forEach((from, to) => {
              inside &&= touches(allowed, from, to)
            })
            return inside
          })
        },
      }),
    ]
  },
})
