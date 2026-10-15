import { sizeCheck, type Limits } from '@suite/collab-client'
import { Extension } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { Fragment, Node, Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey, type PluginSpec, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep, type Step } from '@tiptap/pm/transform'

export interface PasteSizeGuardOptions {
  limits: () => Limits | null
  atLimit: () => boolean
  onTooLarge: () => void
  onNearFull: () => void
}

// No less than what content costs once saved, bar the splits of another writer's text the server adds
function contentBytes(content: Fragment) {
  const json = JSON.stringify(content.toJSON() ?? [])
  const bytes = new TextEncoder().encode(json)
  return bytes.byteLength
}

// Removes content and writes none: text kept after the range would join another block, which Yjs writes anew
function removesOnly(step: Step, doc: Node) {
  if (!(step instanceof ReplaceStep) || step.from >= step.to) return false

  let writesInline = false
  const noteInline = (node: Node) => {
    writesInline ||= node.isInline
  }
  step.slice.content.descendants(noteInline)

  const $from = doc.resolve(step.from)
  const $to = doc.resolve(step.to)
  const endsInText = $to.parent.isTextblock
  const crossesBlocks = !$to.sameParent($from)
  const keepsTextAfter = $to.parentOffset < $to.parent.content.size
  const joinsBlocks = endsInText && crossesBlocks && keepsTextAfter
  return !writesInline && !joinsBlocks
}

const deletesOnly = (tr: Transaction) => tr.steps.every((step, i) => removesOnly(step, tr.docs[i]))

export interface PasteSizeGuardStorage {
  refuses: (content: Fragment, reportTooLarge?: () => void) => boolean
}

// A change too big for one save is refused before it enters the document, so it is never stuck unsaved
export const PasteSizeGuard = Extension.create<PasteSizeGuardOptions, PasteSizeGuardStorage>({
  name: 'pasteSizeGuard',
  priority: 1000,

  addOptions() {
    return {
      limits: () => null,
      atLimit: () => false,
      onTooLarge: () => {},
      onNearFull: () => {},
    }
  },

  // An import asks here before it inserts, as a paste does
  addStorage() {
    const { limits, atLimit, onTooLarge, onNearFull } = this.options
    return {
      refuses: (content: Fragment, reportTooLarge = onTooLarge) => {
        const sizeStatus = sizeCheck(limits(), contentBytes(content))
        if (sizeStatus === 'too_large') {
          reportTooLarge()
        }
        // At the limit the banner already says so
        if (sizeStatus === 'near_full' && !atLimit()) {
          onNearFull()
        }
        return sizeStatus === 'too_large'
      },
    }
  },

  // A document at its limit takes only deletes until a compaction makes room, so nothing else is typed
  addProseMirrorPlugins() {
    const refusesSlice = (slice: Slice) => this.storage.refuses(slice.content)
    const { atLimit } = this.options
    const spec: PluginSpec<unknown> = {
      key: new PluginKey('pasteSizeGuard'),
      filterTransaction: (tr) => {
        if (!tr.docChanged || !atLimit()) return true

        return isChangeOrigin(tr) || deletesOnly(tr)
      },
      props: {
        handlePaste: (_view, _event, slice) => refusesSlice(slice),
        handleDrop: (_view, _event, slice, moved) => !moved && refusesSlice(slice),
      },
    }

    return [new Plugin(spec)]
  },
})
