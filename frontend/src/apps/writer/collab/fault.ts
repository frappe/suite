import { getSchema } from '@tiptap/core'
import { placeFragment } from '@tiptap/y-tiptap'
import { XmlElement, type Doc } from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import { writerSchema } from '@/apps/writer/schema'

const schema = getSchema(writerSchema())

// A body holding content the editor can't place, by the rule it freezes on
export function writerFault(doc: Doc): string | null {
  const body = doc.getXmlFragment(BODY_FIELD)
  const { lost } = placeFragment(body, schema)
  if (!lost.length) {
    return null
  }

  const lostNames = lost.map((type) => {
    if (type instanceof XmlElement) {
      return type.nodeName
    }

    return 'text'
  })
  const names = [...new Set(lostNames)].join(', ')
  return `schema: cannot place ${names}`
}
