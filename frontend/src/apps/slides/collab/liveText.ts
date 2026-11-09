import { Extension, type AnyExtension } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { ySyncPlugin, ySyncPluginKey } from '@tiptap/y-tiptap'
import type * as Y from 'yjs'

import type { RoomPresence } from '@/platform/collab'
import { Carets } from '@/platform/collab/carets'

/** What ties one text editor to one element's text in the live document. */
export function liveTextExtensions(
  fragment: Y.XmlFragment,
  presence: RoomPresence,
): AnyExtension[] {
  const sync = Extension.create({
    name: 'slidesLiveText',
    priority: 1000,
    addProseMirrorPlugins: () => [ySyncPlugin(fragment)],
  })
  return [sync, Carets.configure({ presence })]
}

// A change that came in from the live document, so nothing may be written back for it (Q6)
export function isRemoteChange(transaction: Transaction) {
  const sync = transaction.getMeta(ySyncPluginKey)
  return !!sync?.isChangeOrigin && !sync.isUndoRedoOperation
}
