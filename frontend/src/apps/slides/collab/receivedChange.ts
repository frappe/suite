import type { Transaction } from '@tiptap/pm/state'
import { ySyncPluginKey } from '@tiptap/y-tiptap'

// A change that came in from the live document, a co-editor's or this tab's own undo,
// so nothing may be written back for it (Q6). A write here would also empty the redo
export function isReceivedChange(transaction: Transaction) {
  return !!transaction.getMeta(ySyncPluginKey)?.isChangeOrigin
}
