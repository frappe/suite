import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { TabsExtension } from '@/apps/writer/extensions/tabs'

import { useDocumentTabs } from './useDocumentTabs'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup()
  }
})

async function editorWithTabs() {
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, TabsExtension],
    content:
      '<div data-tab-id="tab-a" data-tab-label="A" data-tab-order="0"><p>A</p></div>' +
      '<div data-tab-id="tab-b" data-tab-label="B" data-tab-order="1"><p>B</p></div>',
  })
  cleanups.push(() => editor.destroy())
  // The extension chooses the first tab when the editor's `create` fires, a tick late
  await new Promise((resolve) => setTimeout(resolve, 0))
  return editor
}

function mountTabRow(editor: Editor) {
  const root = document.createElement('div')
  const app = createApp(
    defineComponent(() => {
      const { activeTabId } = useDocumentTabs(editor)
      return () => h('output', activeTabId.value)
    }),
  )
  app.mount(root)
  return { root, unmount: () => app.unmount() }
}

describe('the tab row', () => {
  it('shows the open tab when it mounts again, with no tab change to tell it', async () => {
    const editor = await editorWithTabs()
    const beforePreview = mountTabRow(editor)
    editor.commands.changeTab('tab-b', false)
    beforePreview.unmount()

    const afterPreview = mountTabRow(editor)
    cleanups.push(afterPreview.unmount)

    expect(afterPreview.root.textContent).toBe('tab-b')
  })
})
