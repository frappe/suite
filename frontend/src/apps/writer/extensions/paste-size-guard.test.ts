import type { Limits } from '@suite/collab-client'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it } from 'vitest'

import { PasteSizeGuard } from './paste-size-guard'

const MiB = 2 ** 20
const empty: Limits = {
  fragment: 256 * 1024,
  edit_max: MiB,
  state_max: 4 * MiB,
  state_bytes: 0,
  tail_bound: 0,
}

let editor: Editor | undefined
// jsdom has no ClipboardEvent, which ProseMirror makes when it is given none
const paste = (view: Editor['view'], text: string) =>
  view.pasteText(text, new Event('paste') as ClipboardEvent)
afterEach(() => editor?.destroy())

function guarded(limits: Limits | null) {
  const said: string[] = []
  editor = new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      PasteSizeGuard.configure({
        limits: () => limits,
        tooLarge: () => said.push('too large'),
        nearFull: () => said.push('nearly full'),
      }),
    ],
  })
  return { view: editor.view, said, text: () => editor!.state.doc.textContent }
}

describe('paste size guard', () => {
  it('a paste over the most one save may hold is refused and the writer is told', () => {
    const { view, said, text } = guarded(empty)

    paste(view, 'y'.repeat(MiB + 1))

    expect([text().length, said]).toEqual([0, ['too large']])
  })

  it('a paste well under it goes in without a word', () => {
    const { view, said, text } = guarded(empty)

    paste(view, 'y'.repeat(MiB / 2))

    expect([text().length, said]).toEqual([MiB / 2, []])
  })

  it('a paste into a nearly full document goes in with a warning', () => {
    const { view, said, text } = guarded({ ...empty, state_bytes: 4 * MiB - 1000 })

    paste(view, 'y'.repeat(2000))

    expect([text().length, said]).toEqual([2000, ['nearly full']])
  })

  it('a tab that has not heard the sizes yet takes the paste', () => {
    const { view, text } = guarded(null)

    paste(view, 'y'.repeat(MiB + 1))

    expect(text().length).toBe(MiB + 1)
  })
})
