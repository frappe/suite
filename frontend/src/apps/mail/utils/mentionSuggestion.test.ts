import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Mention } from 'frappe-ui/editor'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMentionSuggestion, type MentionCandidate } from './mentionSuggestion'

const query = vi.hoisted(() => vi.fn())

vi.mock('@/api', () => ({
  api: { mail: { contacts: { suggest: 'suggest' } } },
  client: { query },
}))
vi.mock('@/apps/mail/components/Controls/MentionList.vue', () => ({ default: {} }))

const asha: MentionCandidate = { email: 'asha@example.com', display_name: 'Asha' }

const setup = () => {
  const onSelect = vi.fn()
  const extension = createMentionSuggestion({ account: () => 'acct', onSelect })
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, Mention, extension],
    content: '<p>Hi @as</p>',
  })
  return { editor, extension, onSelect }
}

let cleanup: Editor | undefined
afterEach(() => {
  cleanup?.destroy()
  vi.useRealTimers()
})

describe('createMentionSuggestion', () => {
  it('replaces the typed @text with the person and hands them to the composer', () => {
    const { editor, extension, onSelect } = setup()
    cleanup = editor

    extension.options.suggestion.command({
      editor,
      range: { from: 4, to: 7 },
      props: asha,
    })

    expect(editor.getText()).toBe('Hi @Asha ')
    expect(editor.getHTML()).toContain('data-id="asha@example.com"')
    expect(onSelect).toHaveBeenCalledWith(asha)
  })

  it('searches the account it is composing from', async () => {
    vi.useFakeTimers()
    query.mockResolvedValueOnce([{ email: 'asha@example.com', name: 'Asha', user_image: null }])
    const { editor, extension } = setup()
    cleanup = editor

    const results = extension.options.suggestion.items({ query: 'as' })
    await vi.advanceTimersByTimeAsync(300)

    expect(query).toHaveBeenCalledWith('suggest', { account: 'acct', text: 'as' })
    await expect(results).resolves.toEqual([
      { email: 'asha@example.com', display_name: 'Asha', image: undefined },
    ])
  })
})
