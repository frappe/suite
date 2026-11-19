import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it, vi } from 'vitest'

import { createEditorBody } from './editorBody'
import { QuotedContentExtension } from './quotedContentExtension'
import { CustomParagraphExtension, mailEditorKit } from './text-editor'

vi.mock('frappe-ui', () => ({ useFileUpload: () => ({}), toast: { error: vi.fn() } }))

// The composer as wired: the body goes in as the editor's `content`, each change comes back out
// through `fromEditor`, and frappe-ui's editor resets itself whenever `content` differs from
// what it holds.
const composer = (body: string) => {
  const editorBody = createEditorBody()
  const state = { body }
  const editor: Editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ paragraph: false }),
      CustomParagraphExtension,
      QuotedContentExtension,
    ],
    content: editorBody.toEditor(body),
    onUpdate: () => {
      state.body = editorBody.fromEditor(editor.getHTML())
      const content = editorBody.toEditor(state.body)
      if (editor.getHTML() !== content) editor.commands.setContent(content)
    },
  })
  return { editor, state }
}

const QUOTE =
  '<div class="frappe_mail_quote">On 9 Sep 2026, a@b.c wrote:' +
  '<blockquote><div>Can you ship on Friday?</div><div><br></div><div>Thanks</div></blockquote></div>'

describe('the composer body', () => {
  it('keeps a reply where it is typed, above an unfolded quote', () => {
    // Unfolded the way the composer's "···" does it: a blank line, then the quote.
    const { editor, state } = composer(`<div>Yes</div><div><br></div>${QUOTE}`)
    editor.commands.setTextSelection(4) // after "Yes"
    editor.commands.insertContent(',')
    editor.commands.insertContent(' on Friday.')
    expect(state.body).toContain(`<div>Yes, on Friday.</div><div><br></div>${QUOTE}`)
    editor.destroy()
  })

  it('takes a blank line in and gives it back as one blank line', () => {
    const { editor, state } = composer('<div>Hi</div><div><br></div><div>Bye</div>')
    editor.commands.setTextSelection(3)
    editor.commands.insertContent('!')
    expect(state.body).toBe('<div>Hi!</div><div><br></div><div>Bye</div>')
    editor.destroy()
  })

  // A browser draws a <br> that ends a block as nothing, and an empty block as no height at all:
  // each line the editor draws as blank has to leave holding something a reader draws.
  const blankLinesDrawn = (html: string) => {
    const host = document.createElement('div')
    host.innerHTML = html
    return Array.from(host.querySelectorAll('div')).filter((line) => {
      const nodes = Array.from(line.childNodes)
      return nodes.length > 0 && nodes.every((node) => node.nodeName === 'BR')
    }).length
  }

  it('sends a blank line made with Shift+Enter as one a reader draws', () => {
    const { editor, state } = composer('')
    editor.commands.insertContent('Hi Robert,')
    editor.commands.setHardBreak()
    editor.commands.enter()
    editor.commands.insertContent('Thanks.')
    expect(state.body).toBe('<div>Hi Robert,<br><br></div><div>Thanks.</div>')
    editor.destroy()
  })

  it('sends a blank line in an aligned paragraph as one a reader draws', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: mailEditorKit(),
      content: '<div>Hi</div>',
    })
    const editorBody = createEditorBody()
    editor.commands.setTextAlign('left')
    editor.commands.setTextSelection(3)
    editor.commands.enter()
    editor.commands.enter()
    editor.commands.insertContent('Bye')
    expect(blankLinesDrawn(editorBody.fromEditor(editor.getHTML()))).toBe(1)
    editor.destroy()
  })

  it('opens a sent blank line as the one blank line it was', () => {
    const sent = '<div>Hi Robert,<br><br></div><div>Thanks.</div>'
    const { editor, state } = composer(sent)
    expect(editor.getText({ blockSeparator: '\n' })).toBe('Hi Robert,\n\nThanks.')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent('!')
    expect(state.body).toBe('<div>Hi Robert,<br><br></div><div>Thanks.!</div>')
    editor.destroy()
  })

  it('leaves a quoted mail as it came', () => {
    const quote = '<div class="frappe_mail_quote"><div>Ok<br></div><div></div></div>'
    expect(createEditorBody().fromEditor(`<div>Hi</div>${quote}`)).toBe(`<div>Hi</div>${quote}`)
  })
})
