import { sizeCheck, type Limits } from '@suite/collab-client'
import { Extension } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { Node, Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep, type Step } from '@tiptap/pm/transform'

export interface PasteSizeGuardOptions {
  limits: () => Limits | null
  atLimit: () => boolean
  tooLarge: () => void
  nearFull: () => void
}

// About what content costs once saved; images pasted inline carry their bytes in it
export const contentBytes = (json: unknown) =>
  new TextEncoder().encode(JSON.stringify(json ?? [])).byteLength

export const sliceBytes = (slice: Slice) => contentBytes(slice.content.toJSON())

// Removes content and writes none: text kept after the range would join another block, which Yjs writes anew
function removesOnly(step: Step, doc: Node) {
  if (!(step instanceof ReplaceStep) || step.from >= step.to) return false
  let writes = false
  step.slice.content.descendants((node) => {
    writes ||= node.isInline
  })
  const $from = doc.resolve(step.from)
  const $to = doc.resolve(step.to)
  const joins =
    $to.parent.isTextblock && !$to.sameParent($from) && $to.parentOffset < $to.parent.content.size
  return !writes && !joins
}

const deletesOnly = (tr: Transaction) => tr.steps.every((step, i) => removesOnly(step, tr.docs[i]))

export interface PasteSizeGuardStorage {
  refuses: (bytes: number) => boolean
}

// A change too big for one save is refused before it enters the document, so it is never stuck unsaved
export const PasteSizeGuard = Extension.create<PasteSizeGuardOptions, PasteSizeGuardStorage>({
  name: 'pasteSizeGuard',
  priority: 1000,

  addOptions() {
    return { limits: () => null, atLimit: () => false, tooLarge: () => {}, nearFull: () => {} }
  },

  // An import asks here before it inserts, as a paste does
  addStorage() {
    const { limits, tooLarge, nearFull } = this.options
    return {
      refuses: (bytes: number) => {
        const fit = sizeCheck(limits(), bytes)
        if (fit === 'too_large') tooLarge()
        if (fit === 'near_full') nearFull()
        return fit === 'too_large'
      },
    }
  },

  // A document at its limit takes only deletes until a compaction makes room, so nothing else is typed
  addProseMirrorPlugins() {
    const refuse = (slice: Slice) => this.storage.refuses(sliceBytes(slice))
    const { atLimit } = this.options
    return [
      new Plugin({
        key: new PluginKey('pasteSizeGuard'),
        filterTransaction: (tr) =>
          !tr.docChanged || !atLimit() || isChangeOrigin(tr) || deletesOnly(tr),
        props: {
          handlePaste: (_view, _event, slice) => refuse(slice),
          handleDrop: (_view, _event, slice, moved) => !moved && refuse(slice),
        },
      }),
    ]
  },
})
