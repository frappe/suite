import { getSchema } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { changedRanges, touches } from './ranges'

const schema = getSchema([Document, Paragraph, Text])

function stateWith(text: string) {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])])
  return EditorState.create({ schema, doc })
}

describe('changed ranges', () => {
  it('a step that inserts before an earlier step moves that step range to its new place', () => {
    const tr = stateWith('xyz').tr.insertText('ab', 2).insertText('Q', 1)

    expect(changedRanges([tr])).toEqual([
      [3, 5],
      [1, 2],
    ])
  })

  it('a later transaction that inserts before an earlier one moves the earlier range', () => {
    const first = stateWith('xyz').tr.insertText('ab', 2)
    const second = EditorState.create({ schema, doc: first.doc }).tr.insertText('Q', 1)

    expect(changedRanges([first, second])).toEqual([
      [3, 5],
      [1, 2],
    ])
  })

  it('a position touches a range at either end, and not one place past it', () => {
    const ranges: [number, number][] = [[3, 5]]

    expect([
      touches(ranges, 5),
      touches(ranges, 6),
      touches(ranges, 1, 3),
      touches(ranges, 1, 2),
    ]).toEqual([true, false, true, false])
  })
})
