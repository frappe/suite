import type { Fault } from '@suite/collab-client'
import { getSchema } from '@tiptap/core'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'

import { FIELD } from '@/apps/writer/collab/field'
import { writerSchema } from '@/apps/writer/schema'

const schema = getSchema(writerSchema())

// A body the editor can't hold; an empty body is a new document, which the editor fills itself
export const writerFault: Fault = (doc) => {
  const body = doc.getXmlFragment(FIELD)
  if (!body.length) return null

  try {
    const root = yXmlFragmentToProseMirrorRootNode(body, schema)
    root.check()
    return null
  } catch (error) {
    return `schema: ${String(error)}`
  }
}
