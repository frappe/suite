import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { fromPartial } from '@total-typescript/shoehorn'
import { Mention } from 'frappe-ui/editor'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMentionSuggestion } from './mentionSuggestion'

const query = vi.hoisted(() => vi.fn())

vi.mock('@/api', () => ({
  api: { mail: { contacts: { suggest: 'suggest' } } },
  client: { query },
}))
// The list itself is real; only frappe-ui's row and avatar are reduced to plain elements.
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Avatar: defineComponent({ render: () => h('span') }),
    ItemListRow: defineComponent({
      props: { as: { type: String, default: 'div' }, selected: Boolean },
      setup:
        (props, { attrs, slots }) =>
        () =>
          h(props.as, attrs, slots.label?.()),
    }),
  }
})

// jsdom measures no text; the editor scrolls to the caret and the list places itself at it
Range.prototype.getClientRects = () => fromPartial<DOMRectList>({ length: 0, item: () => null })
Range.prototype.getBoundingClientRect = () => new DOMRect()

let cleanup = () => {}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// An editor on the page with the caret at the end of its line, as the composer has it.
const setup = () => {
  const onSelect = vi.fn()
  const element = document.body.appendChild(document.createElement('div'))
  const editor = new Editor({
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Mention,
      createMentionSuggestion({ account: () => 'acct', onSelect }),
    ],
    content: '<p>Hi</p>',
  })
  editor.commands.focus('end')
  cleanup = () => {
    editor.destroy()
    element.remove()
  }
  return { editor, onSelect }
}

const row = (name: string) =>
  Array.from(document.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(name),
  )

describe('typing @ in the composer', () => {
  it('lists the people the account writes to, and puts the one picked in place of the @text', async () => {
    vi.useFakeTimers()
    query.mockResolvedValue([{ email: 'asha@example.com', name: 'Asha', user_image: null }])
    const { editor, onSelect } = setup()

    editor.commands.insertContent(' @as')
    await vi.advanceTimersByTimeAsync(300)

    expect(query).toHaveBeenCalledWith('suggest', { account: 'acct', text: 'as' })
    row('Asha')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    expect(editor.getText()).toBe('Hi @Asha ')
    expect(editor.getHTML()).toContain('data-id="asha@example.com"')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ email: 'asha@example.com' }))
    expect(row('Asha')).toBeUndefined()
  })
})
