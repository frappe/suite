import { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'

import { MediaInsert } from './media-insert'
import { ScrollToInserted } from './scroll-to-inserted'

let editor: Editor | null = null

afterEach(() => {
  vi.restoreAllMocks()
  editor?.destroy()
  editor = null
})

function open(extension: typeof MediaInsert | typeof ScrollToInserted, content: string) {
  editor = new Editor({ extensions: [...writerSchema(), extension], content })
  return editor
}

/** How many block inserts the scroll plugin has counted, which is what makes it scroll. */
function insertsCounted(target: Editor): number {
  const plugin = target.state.plugins.find((candidate) =>
    String((candidate.spec.key as { key?: string } | undefined)?.key).startsWith(
      'scrollToInserted',
    ),
  )
  return plugin?.getState(target.state) as number
}

describe('scroll to inserted', () => {
  it('counts a block that goes in, but not typing', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0)
    const target = open(ScrollToInserted, '<p>Text</p>')

    target.commands.insertContent('more words')
    expect(insertsCounted(target)).toBe(0)

    target.commands.setHorizontalRule()
    expect(insertsCounted(target)).toBe(1)

    target.commands.insertTable({ rows: 2, cols: 2 })
    expect(insertsCounted(target)).toBe(2)
  })

  it('does not count the whole document being loaded', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0)
    const target = open(ScrollToInserted, '<p>Text</p>')

    target.commands.setContent('<p>Other</p><hr>')
    expect(insertsCounted(target)).toBe(0)
  })
})

describe('media insert', () => {
  it('puts the caret on an empty line after a video that goes in selected', () => {
    const target = open(MediaInsert, '<p>Before</p>')
    const video = target.schema.nodes.video.create({ src: '/v.mp4' })
    const at = target.state.doc.content.size
    const { tr } = target.state
    tr.insert(at, video)
    tr.setSelection(NodeSelection.create(tr.doc, at))
    target.view.dispatch(tr)

    const { selection } = target.state
    expect(selection).toBeInstanceOf(TextSelection)
    expect(selection.$from.parent.type.name).toBe('paragraph')
    expect(selection.$from.parent.content.size).toBe(0)
    expect(target.state.doc.child(1).type.name).toBe('video')
  })

  it('leaves a video selected when it was already there', () => {
    const target = open(MediaInsert, '<p>Before</p>')
    const video = target.schema.nodes.video.create({ src: '/v.mp4' })
    const at = target.state.doc.content.size
    target.view.dispatch(target.state.tr.insert(at, video))

    target.view.dispatch(target.state.tr.setSelection(NodeSelection.create(target.state.doc, at)))
    expect(target.state.selection).toBeInstanceOf(NodeSelection)
  })
})
