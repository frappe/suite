import { sizeCheck, type Limits } from '@suite/collab-client'
import { Extension } from '@tiptap/core'
import type { Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface PasteSizeGuardOptions {
  limits: () => Limits | null
  tooLarge: () => void
  nearFull: () => void
}

// About what content costs once saved; images pasted inline carry their bytes in it
export const contentBytes = (json: unknown) =>
  new TextEncoder().encode(JSON.stringify(json ?? [])).byteLength

export const sliceBytes = (slice: Slice) => contentBytes(slice.content.toJSON())

export interface PasteSizeGuardStorage {
  refuses: (bytes: number) => boolean
}

// A change too big for one save is refused before it enters the document, so it is never stuck unsaved
export const PasteSizeGuard = Extension.create<PasteSizeGuardOptions, PasteSizeGuardStorage>({
  name: 'pasteSizeGuard',
  priority: 1000,

  addOptions() {
    return { limits: () => null, tooLarge: () => {}, nearFull: () => {} }
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

  addProseMirrorPlugins() {
    const refuse = (slice: Slice) => this.storage.refuses(sliceBytes(slice))
    return [
      new Plugin({
        key: new PluginKey('pasteSizeGuard'),
        props: {
          handlePaste: (_view, _event, slice) => refuse(slice),
          handleDrop: (_view, _event, slice, moved) => !moved && refuse(slice),
        },
      }),
    ]
  },
})
