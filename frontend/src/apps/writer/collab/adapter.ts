import type { ContentAdapter } from '@suite/collab-client'
import type { AnyExtension } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'

import { caretPosition, Carets } from '@/apps/writer/collab/carets'
import { BODY_FIELD } from '@/apps/writer/collab/field'
import { writerRender } from '@/apps/writer/collab/render'
import { SteadyCaret } from '@/apps/writer/collab/steady-caret'
import { UndoAfterRestore } from '@/apps/writer/collab/undo-after-restore'

import features from '../../../../../suite/writer/content/features.json'

export const writerAdapter: ContentAdapter<AnyExtension[]> = {
  features,
  position: caretPosition,
  render: writerRender,
  bind: (room, onFrozen) => [
    Collaboration.configure({
      document: room.doc,
      field: BODY_FIELD,
      ySyncOptions: { onUnplaceable: onFrozen },
    }),
    Carets.configure({ presence: room.presence }),
    SteadyCaret,
    UndoAfterRestore.configure({ room }),
  ],
}
