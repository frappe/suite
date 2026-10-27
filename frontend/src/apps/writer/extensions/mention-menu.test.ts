import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Mention } from 'frappe-ui/editor'
import { afterEach, expect, it, vi } from 'vitest'

import type { WriterUser } from '@/apps/writer/drive'

import { MentionMenuExtension } from './mention-menu'

const asked = vi.hoisted(() => [] as string[])

vi.mock('@/platform/session', async () => {
  const { ref } = await import('vue')
  return { useSession: () => ({ user: ref('owner@suite.test') }) }
})

vi.mock('@/apps/writer/drive', () => {
  const person = (name: string, label: string, hasAccess: boolean): WriterUser => ({
    name,
    email: name,
    full_name: label,
    user_image: null,
    value: name,
    label,
    has_access: hasAccess,
  })
  const everyone = [
    person('maya@suite.test', 'Maya Reader', true),
    person('omar@suite.test', 'Omar Outside', false),
  ]
  return {
    searchUsers: async (query: string) => {
      asked.push(query)
      return everyone.filter((user) => user.label.toLowerCase().includes(query.toLowerCase()))
    },
  }
})

// jsdom measures no text; the editor scrolls to the caret and the menu places itself at it
Range.prototype.getClientRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  document.body.innerHTML = ''
})

function menuRows() {
  return [...document.querySelectorAll('[role="option"]')].map((row) => row.textContent?.trim())
}

it('offers people with their email and access, asks the server as you type, and inserts the pick', async () => {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, Mention.configure({}), MentionMenuExtension],
    content: '<p>Ping</p>',
  })
  editor.commands.focus('end')
  editor.commands.insertContent(' @')
  await vi.waitFor(() => expect(menuRows()).toHaveLength(2))
  expect(menuRows()[0]).toMatch(/Maya Reader\s*maya@suite\.test/)
  expect(menuRows()[1]).toMatch(/Omar Outside\s*omar@suite\.test\s*No access/)

  editor.commands.insertContent('oma')
  await vi.waitFor(() => expect(menuRows()).toHaveLength(1))
  expect(asked).toContain('oma')

  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.waitFor(() =>
    expect(editor!.getHTML()).toContain('data-id="omar@suite.test" data-label="Omar Outside"'),
  )
  expect(editor.getText()).toBe('Ping @Omar Outside ')
})
