import { nodeIcon, nodeIconTint } from '../../internal/icons'

/** Where a document's edits are. Each editor reports its own. */
export type DocumentSaveState = 'clean' | 'saving' | 'unsaved' | 'failed'

/** A side panel the header toggles. Each editor renders the panel itself. */
export type DocumentPanel = 'comments' | 'versions'

export const PANEL_BUTTONS: Record<DocumentPanel, { label: string; icon: string }> = {
  comments: { label: 'Comments', icon: 'lucide-messages-square' },
  versions: { label: 'Versions', icon: 'lucide-history' },
}

export const SAVE_LABELS: Record<DocumentSaveState, string> = {
  clean: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved',
  failed: 'Not saved',
}

/** The Drive file-type icon and tint, the same ones the listing shows. */
export function documentTypeIcon(contentDoctype: string, mime: string | null = null): string[] {
  // A file preview session names the `File` doctype; every other session is a document.
  const node = contentDoctype === 'File'
    ? { kind: 'file', mime, content_doctype: null }
    : { kind: 'document', mime: null, content_doctype: contentDoctype }
  return [nodeIcon(node), nodeIconTint(node)]
}
