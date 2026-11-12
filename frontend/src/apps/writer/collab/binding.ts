import type { AnyExtension } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import { SteadyCaret } from '@/apps/writer/collab/steady-caret'
import { UndoAfterRestore } from '@/apps/writer/collab/undo-after-restore'
import type { CollabRoom } from '@/platform/collab'
import { Carets } from '@/platform/collab/carets'
import { UndoSteps } from '@/platform/collab/undo-steps'

// Ties the editor to a room's document and draws its peers. `onFrozen` hears when the document
// holds content the editor can't show, after which the editor takes no edits
export function writerBinding(room: CollabRoom, onFrozen: () => void): AnyExtension[] {
  return [
    Collaboration.configure({
      document: room.doc,
      field: BODY_FIELD,
      ySyncOptions: { onUnplaceable: onFrozen },
    }),
    Carets.configure({ presence: room.presence }),
    SteadyCaret,
    UndoAfterRestore.configure({ room }),
    UndoSteps,
  ]
}
