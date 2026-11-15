import type { DocumentSession } from '@/apps/drive/client/session'
import type { DocumentPanel } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'

import { nodeIcon, nodeIconTint } from '../../internal/icons'
import { copyLink } from '../share/shareFormat'

/** Where a document's edits are. Each editor reports its own. */
export type DocumentSaveState = 'clean' | 'saving' | 'unsaved' | 'failed'

export const PANEL_BUTTONS: Record<DocumentPanel, { label: string; icon: string }> = {
  comments: { label: 'Comments', icon: 'lucide-messages-square' },
  versions: { label: 'Versions', icon: 'lucide-history' },
}

/**
 * The Drive file-type icon and tint, the same ones the listing shows. A file's
 * title counts, because its extension can say more than its MIME type.
 */
export function documentTypeIcon(
  contentDoctype: string,
  title: string,
  mime: string | null = null,
): string[] {
  // A file preview session names the `File` doctype; every other session is a document.
  const node =
    contentDoctype === 'File'
      ? { kind: 'file', title, mime, content_doctype: null }
      : { kind: 'document', title, mime: null, content_doctype: contentDoctype }
  return [nodeIcon(node), nodeIconTint(node)]
}

/** The Star toggle for a document's menu. Empty when the person cannot star the document. */
export function starAction(session: Pick<DocumentSession, 'canStar' | 'isStarred' | 'setStarred'>) {
  if (!session.canStar.value) return []
  const starred = session.isStarred.value
  return [
    {
      label: starred ? __('Unstar') : __('Star'),
      icon: starred ? 'lucide-star-off' : 'lucide-star',
      onClick: () => void session.setStarred(!starred),
    },
  ]
}

/** Copy link for a document's menu. It copies the address of the open page. */
export function copyLinkAction() {
  return {
    label: __('Copy link'),
    icon: 'lucide-link',
    onClick: () => void copyLink(window.location.pathname + window.location.search),
  }
}
