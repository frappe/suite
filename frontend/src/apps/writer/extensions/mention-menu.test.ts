import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Mention } from 'frappe-ui/editor'
import { afterEach, expect, it, vi } from 'vitest'

import { rankMentionsFor } from '@/apps/drive'
import MentionMenu from '@/apps/writer/components/MentionMenu.vue'

import { mentionMenuExtension } from './mention-menu'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const asked = vi.hoisted(() => fromPartial<string[]>([]))

vi.mock('@/platform/session', async (importOriginal) => {
  const { ref } = await import('vue')
  const original = await importOriginal<typeof import('@/platform/session')>()
  const user = ref('owner@suite.test')
  return { ...original, useSession: () => ({ ...original.useSession(), user }) }
})

// The people route answers with users whose name holds the query
vi.mock('@/api', async (importOriginal) => {
  function person(name: string, fullName: string, hasAccess: boolean) {
    return {
      kind: 'user',
      name,
      email: name,
      full_name: fullName,
      user_image: null,
      has_access: hasAccess,
    }
  }
  const everyone = [
    person('maya@suite.test', 'Maya Reader', true),
    person('omar@suite.test', 'Omar Outside', false),
  ]
  return {
    ...(await importOriginal<typeof import('@/api')>()),
    client: {
      query: async (_route: unknown, { q: query = '' }: { q?: string }) => {
        asked.push(query)
        return {
          rows: everyone.filter((user) =>
            user.full_name.toLowerCase().includes(query.toLowerCase()),
          ),
        }
      },
    },
  }
})

// jsdom measures no text; the editor scrolls to the caret and the menu places itself at it
Range.prototype.getClientRects = () => fromPartial<DOMRectList>({ length: 0, item: () => null })
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
  rankMentionsFor('document-1')
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Mention.configure({}),
      mentionMenuExtension(MentionMenu),
    ],
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
