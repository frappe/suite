import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { writerEditorExtensions } from '../editor-extensions'
import { withDocumentLook } from './paste'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function writerEditor(content: string) {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({
    element,
    content,
    extensions: writerEditorExtensions({
      isCollaborative: false,
      onCommentActivated: () => {},
      onAnchors: () => {},
      scrollParent: () => window,
      media: null,
    }),
  })
  return editor
}

const blocks = (editor: Editor) =>
  editor.getJSON().content?.map((block) => `${block.type}:${textOf(block)}`)

const textOf = (node: { text?: string; content?: object[] }): string =>
  node.text ?? (node.content ?? []).map(textOf).join('')

function press(editor: Editor, shortcut: string) {
  const key = shortcut.replace('Mod-', '')
  const ctrlKey = shortcut.startsWith('Mod-')
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true }))
}

function paste(editor: Editor, data: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  const clipboardData = {
    getData: (type: string) => data[type] ?? '',
    types: Object.keys(data),
    files: [],
  }
  Object.defineProperty(event, 'clipboardData', { value: clipboardData })
  editor.view.dom.dispatchEvent(event)
}

describe('code block keys', () => {
  it('leaves a code block on the third Enter at its end', () => {
    const editor = writerEditor('<pre><code>const a = 1</code></pre>')
    editor.commands.setTextSelection(12)
    press(editor, 'Enter')
    press(editor, 'Enter')
    press(editor, 'Enter')
    editor.commands.insertContent('after')

    expect(blocks(editor)).toEqual(['codeBlock:const a = 1', 'paragraph:after'])
  })

  it('keeps one empty line inside a code block', () => {
    const editor = writerEditor('<pre><code>a</code></pre>')
    editor.commands.setTextSelection(2)
    press(editor, 'Enter')
    press(editor, 'Enter')
    editor.commands.insertContent('b')

    expect(blocks(editor)?.[0]).toBe('codeBlock:a\n\nb')
  })

  it('leaves a code block at the end of the document on ArrowDown', () => {
    const editor = writerEditor('<p>intro</p><pre><code>x = 2</code></pre>')
    editor.commands.setTextSelection(13)
    press(editor, 'ArrowDown')
    editor.commands.insertContent('below')

    expect(blocks(editor)).toEqual(['paragraph:intro', 'codeBlock:x = 2', 'paragraph:below'])
  })
})

describe('checklist keys', () => {
  const list =
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Send docs</p></li>' +
    '<li data-type="taskItem" data-checked="true"><p>Book review</p></li></ul>'
  const checks = (editor: Editor) =>
    editor.getJSON().content?.[0]?.content?.map((item) => item.attrs?.checked)

  it('checks the item the caret is in on Mod-Enter, and unchecks it on the next', () => {
    const editor = writerEditor(list)
    editor.commands.setTextSelection(5)

    press(editor, 'Mod-Enter')
    expect(checks(editor)).toEqual([true, true])
    press(editor, 'Mod-Enter')
    expect(checks(editor)).toEqual([false, true])
  })

  it('checks every selected item unless all are checked', () => {
    const editor = writerEditor(list)
    editor.commands.setTextSelection({ from: 5, to: 20 })

    press(editor, 'Mod-Enter')
    expect(checks(editor)).toEqual([true, true])
    press(editor, 'Mod-Enter')
    expect(checks(editor)).toEqual([false, false])
  })

  it('keeps Mod-Enter as a line break outside a checklist', () => {
    const editor = writerEditor('<p>ab</p>')
    editor.commands.setTextSelection(2)
    press(editor, 'Mod-Enter')

    expect(editor.getHTML()).toContain('a<br>b')
  })
})

describe('pasting', () => {
  const googleDocs =
    '<b style="font-weight:normal;" id="docs-internal-guid-1">' +
    '<h2 style="line-height:1.38;margin-top:18pt;"><span style="font-size:16pt;font-family:Arial,sans-serif;">Notes</span></h2>' +
    '<p style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">' +
    '<span style="font-size:11pt;font-family:Arial,sans-serif;">Body text and more body</span>' +
    '<span style="font-size:20pt;font-family:Arial,sans-serif;color:#ff0000;">Big</span></p></b>'

  it('drops the source font, spacing, heading sizes and body size, and keeps other sizes', () => {
    const template = document.createElement('template')
    template.innerHTML = withDocumentLook(googleDocs)
    const styles = [...template.content.querySelectorAll('[style]')].map((element) =>
      element.getAttribute('style'),
    )

    expect(styles).toEqual([
      'font-weight:normal;',
      '',
      '',
      '',
      '',
      'font-size: 27px; color: rgb(255, 0, 0);',
    ])
  })

  it('keeps the formatting of what Writer copied', () => {
    const copied = '<p data-pm-slice="1 1 []"><span style="font-family: Georgia">x</span></p>'
    expect(withDocumentLook(copied)).toBe(copied)
  })

  it('pastes Markdown-like text as it is with Mod-Shift-v, and as Markdown without Shift', () => {
    const editor = writerEditor('<p></p>')
    editor.commands.setTextSelection(1)
    const text = '- item\n1. step'

    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true }),
    )
    paste(editor, { 'text/plain': text })
    expect(blocks(editor)).toEqual(['paragraph:- item', 'paragraph:1. step'])

    editor.commands.setContent('<p></p>')
    editor.view.dom.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }))
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }),
    )
    paste(editor, { 'text/plain': text })
    expect(blocks(editor)?.slice(0, 2)).toEqual(['bulletList:item', 'orderedList:step'])
  })
})

describe('putting in blocks', () => {
  it('types after a page break on a new line, before a code block and at the end', () => {
    const editor = writerEditor('<p>one</p><pre><code>code()</code></pre>')
    editor.chain().setTextSelection(4).setPageBreak().run()
    editor.commands.insertContent('next')
    editor.chain().focus('end').setPageBreak().run()
    editor.commands.insertContent('end')

    expect(blocks(editor)).toEqual([
      'paragraph:one',
      'pageBreak:',
      'paragraph:next',
      'codeBlock:code()',
      'pageBreak:',
      'paragraph:end',
    ])
  })

  it('moves the caret after a video it would replace, and undoes the video and its upload at once', () => {
    const editor = writerEditor('<p>Before</p>')
    editor.commands.setTextSelection(7)
    const { video } = editor.schema.nodes
    const placeholder = video.create({ loading: true, uploadId: 'u1' })
    editor.view.dispatch(editor.state.tr.replaceSelectionWith(placeholder))
    const position = editor.state.doc.child(0).nodeSize
    const finished = { ...placeholder.attrs, loading: false, src: '/files/clip.mp4' }
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, finished).setTime(Date.now() + 5000),
    )

    editor.commands.insertContent('after')
    expect(blocks(editor)).toEqual(['paragraph:Before', 'video:', 'paragraph:after'])

    editor.commands.undo()
    editor.commands.undo()
    expect(blocks(editor)).toEqual(['paragraph:Before'])
  })
})

describe('link and highlight look', () => {
  it('drops the colour and underline Google Docs gives a link', () => {
    const link =
      '<p><a href="https://example.com" style="text-decoration:none;"><span style="color:#1155cc;' +
      'text-decoration:underline;">the plan</span></a> <u>kept</u></p>'
    const editor = writerEditor('<p></p>')
    editor.commands.setTextSelection(1)
    paste(editor, { 'text/html': link, 'text/plain': 'the plan kept' })

    const html = editor.getHTML()
    expect(html).toContain('href="https://example.com"><span>the plan</span></a>')
    expect(html).toContain('<u>kept</u>')
  })

  it('highlights the selection on Mod-Shift-h, and removes it on the next', () => {
    const editor = writerEditor('<p>key point</p>')
    editor.commands.setTextSelection({ from: 1, to: 4 })
    const highlight = () =>
      editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'H',
          keyCode: 72,
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      )

    highlight()
    expect(editor.isActive('namedHighlight')).toBe(true)
    highlight()
    expect(editor.isActive('namedHighlight')).toBe(false)
  })
})
