import { caretPosition } from '@/apps/writer/collab/carets'
import { writerRender } from '@/apps/writer/collab/render'
import type { CollabAdapter } from '@/platform/collab'

import declared from '../../../../../suite/writer/content/schema.json'

export const writerAdapter: CollabAdapter = {
  app: 'writer',
  schemaVersion: declared.schema,
  toPeerPosition: caretPosition,
  toHtml: (doc) => writerRender(doc).html,
}
