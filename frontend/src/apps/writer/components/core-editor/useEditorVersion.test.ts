import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, expect, it } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useEditorVersion } from './useEditorVersion'

const editors: Editor[] = []
const scope = effectScope()

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function open() {
  const editor = new Editor({ extensions: [Document, Paragraph, Text] })
  editors.push(editor)
  return editor
}

it('moves on every transaction of the current editor only', async () => {
  const first = open()
  const current = shallowRef<Editor | null>(first)
  const version = scope.run(() => useEditorVersion(current))!

  first.commands.insertContent('a')
  first.commands.insertContent('b')
  expect(version.value).toBe(2)

  const second = open()
  current.value = second
  await nextTick()
  first.commands.insertContent('c')
  expect(version.value).toBe(2)
  second.commands.insertContent('d')
  expect(version.value).toBe(3)

  current.value = null
  await nextTick()
  second.commands.insertContent('e')
  expect(version.value).toBe(3)
})
