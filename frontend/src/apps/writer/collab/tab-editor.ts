import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import type { Doc } from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import { writerEditorExtensions } from '@/apps/writer/editor-extensions'

/** An editor on the document with the extensions a tab opens it with, drawn nowhere. */
export function tabEditor(doc: Doc) {
  const extensions = writerEditorExtensions({
    isCollaborative: true,
    mentionItems: () => [],
    onMentionQuery: () => {},
    onCommentActivated: () => {},
    onAnchors: () => {},
    scrollParent: () => window,
    media: null,
  })
  return new Editor({
    element: document.createElement('div'),
    extensions: [...extensions, Collaboration.configure({ document: doc, field: BODY_FIELD })],
  })
}
