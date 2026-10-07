import { sizeCheck, type Limits } from '@suite/collab-client'
import { Extension } from '@tiptap/core'
import type { Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface PasteSizeGuardOptions {
  limits: () => Limits | null
  tooLarge: () => void
  nearFull: () => void
}

// About what the slice costs once saved; images pasted inline carry their bytes in it
export const sliceBytes = (slice: Slice) =>
  new TextEncoder().encode(JSON.stringify(slice.content.toJSON() ?? [])).byteLength

// A change too big for one save is refused before it enters the document, so it is never stuck unsaved
export const PasteSizeGuard = Extension.create<PasteSizeGuardOptions>({
  name: 'pasteSizeGuard',
  priority: 1000,

  addOptions() {
    return { limits: () => null, tooLarge: () => {}, nearFull: () => {} }
  },

  addProseMirrorPlugins() {
    const { limits, tooLarge, nearFull } = this.options
    const refuse = (slice: Slice) => {
      const fit = sizeCheck(limits(), sliceBytes(slice))
      if (fit === 'too_large') tooLarge()
      if (fit === 'near_full') nearFull()
      return fit === 'too_large'
    }
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
