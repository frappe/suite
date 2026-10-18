import type { EditorOptions, JSONContent } from '@tiptap/core'
import { Editor } from '@tiptap/vue-3'

import { DriveMedia, type DocumentMedia } from '@/apps/writer/extensions/drive-media'
import { writerSchema } from '@/apps/writer/schema'
import { EDITOR_TEXT_CLASS } from '@/apps/writer/utils/editor-layout'

/** A read-only editor that shows content through Writer's schema. */
export function previewEditor(
  content: string | JSONContent,
  media: DocumentMedia | null,
  onContentError: () => void,
) {
  const options: Partial<EditorOptions> = {
    extensions: [...writerSchema(), DriveMedia.configure({ media })],
    content,
    editable: false,
    editorProps: { attributes: { class: `${EDITOR_TEXT_CLASS} max-w-none` } },
    // HTML parses as loosely as the live editor; only Yjs state is checked
    enableContentCheck: typeof content !== 'string',
    onContentError,
  }
  return new Editor(options)
}
