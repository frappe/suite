import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, expect, it } from 'vitest'

import { PageBreakExtension } from './page-break'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

it('labels a page break in the editor but saves it as a bare break', () => {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [Document, Paragraph, Text, PageBreakExtension],
    content: '<p>Before</p><div data-page-break="true"></div><p>After</p>',
  })

  const shown = editor.view.dom.querySelector<HTMLElement>('[data-page-break="true"]')
  expect(shown?.dataset.label).toBe('Page break')
  expect(editor.getHTML()).toBe('<p>Before</p><div data-page-break="true"></div><p>After</p>')
})
