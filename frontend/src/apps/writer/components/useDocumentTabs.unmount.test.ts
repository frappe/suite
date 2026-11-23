import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { expect, it } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { TabsExtension } from '@/apps/writer/extensions/tabs'

import { useDocumentTabs } from './useDocumentTabs'

it('unmounts quietly after the editor is destroyed, as the mobile tab bar does when a document closes', () => {
  const editor = new Editor({ extensions: [Document, Paragraph, Text, TabsExtension] })
  const app = createApp(
    defineComponent(() => {
      useDocumentTabs(editor)
      return () => h('div')
    }),
  )
  const errors: unknown[] = []
  app.config.errorHandler = (error) => void errors.push(error)
  app.mount(document.createElement('div'))

  editor.destroy()
  app.unmount()

  expect(errors).toEqual([])
})
