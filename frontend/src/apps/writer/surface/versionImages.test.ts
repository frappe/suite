import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { describe, expect, it } from 'vitest'
import { encodeStateAsUpdate } from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab'
import { writerSchema } from '@/apps/writer/schema'

import { versionImages } from './versionImages'

function embed(id: string) {
  return '/api/method/suite.writer.api.embed.get?id=' + id
}

describe('versionImages', () => {
  it('reads the images a stored version shows, each once', () => {
    const schema = getSchema(writerSchema())
    const content = schema
      .nodeFromJSON({
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: embed('one'), alt: 'Chart' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'between' }] },
          { type: 'image', attrs: { src: embed('one') } },
          { type: 'image', attrs: { src: 'https://example.com/a.png' } },
        ],
      })
      .toJSON()
    const state = encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, content, BODY_FIELD))

    expect(versionImages({ lineage: 'l', state })).toEqual([{ id: 'one', alt: 'Chart' }])
  })

  it('reads the images of a version kept as HTML, in either spelling', () => {
    const first = embed('one')
    const html = `<p>x</p><img src="${first}" alt="Logo"><img data-node="two"><img src="/files/a.png">`

    expect(versionImages({ html })).toEqual([
      { id: 'one', alt: 'Logo' },
      { id: 'two', alt: '' },
    ])
  })
})
