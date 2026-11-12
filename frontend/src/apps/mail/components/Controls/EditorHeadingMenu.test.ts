import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Heading from '@tiptap/extension-heading'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import EditorHeadingMenu from './EditorHeadingMenu.vue'

vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Button: defineComponent({
      props: { label: String, iconLeft: [String, Object], icon: [String, Object] },
      setup:
        (props, { attrs }) =>
        () =>
          h('button', attrs, props.label),
    }),
    // Both slots at once: what is under test is the choice, not the popover opening.
    Popover: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          h('div', [slots.trigger?.(), slots.default?.({ close: () => {} })]),
    }),
  }
})

let cleanup = () => {}
afterEach(() => cleanup())

const setup = () => {
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, Heading.configure({ levels: [2, 3, 4, 5, 6] })],
    content: '<p>Title</p>',
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(EditorHeadingMenu, { editor }) })
  app.mount(host)
  cleanup = () => {
    app.unmount()
    host.remove()
    editor.destroy()
  }
  const buttons = () => Array.from(host.querySelectorAll('button'))
  const trigger = () => buttons()[0]
  const option = (label: string) =>
    buttons()
      .slice(1)
      .find((button) => button.textContent === label)!
  return { editor, trigger, option }
}

describe('EditorHeadingMenu', () => {
  it('offers the five headings a mail can use', () => {
    const { option } = setup()
    for (const label of ['Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6'])
      expect(option(label)).toBeDefined()
  })

  it('turns the line into the picked heading', () => {
    const { editor, option } = setup()
    option('Heading 5').click()
    expect(editor.getHTML()).toBe('<h5>Title</h5>')
  })

  it('shows the heading the caret is in, and follows it', async () => {
    const { editor, trigger } = setup()
    expect(trigger().getAttribute('aria-pressed')).toBe('false')

    editor.commands.setHeading({ level: 3 })
    await nextTick()
    expect(trigger().getAttribute('aria-pressed')).toBe('true')
    expect(trigger().textContent).toBe('Heading 3')
  })
})
