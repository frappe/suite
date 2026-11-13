import { Editor, type AnyExtension } from '@tiptap/core'
import { Mention } from 'frappe-ui/editor'
import { describe, expect, it, vi } from 'vitest'

import { QuotedContentExtension } from './quotedContentExtension'
import { CustomImageExtension, mailEditorKit } from './text-editor'

vi.mock('frappe-ui', () => ({ useFileUpload: () => ({}), toast: { error: vi.fn() } }))

const roundTrip = (html: string, extensions: AnyExtension[] = composerExtensions()) => {
  const editor = new Editor({ extensions, content: html })
  try {
    return editor.getHTML()
  } finally {
    editor.destroy()
  }
}

const composerExtensions = () => [
  ...mailEditorKit({ image: CustomImageExtension }),
  QuotedContentExtension,
  Mention,
]

// What the send path keys on: an image with a `data-cid` goes out as an inline attachment.
const imageCid = (html: string) => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.querySelector('img')?.getAttribute('data-cid')
}

describe('mailEditorKit', () => {
  it('keeps a mail line as a div and a blank line as an empty one', () => {
    expect(roundTrip('<div>Hello</div><div><br></div><div>World</div>')).toBe(
      '<div>Hello</div><div></div><div>World</div>',
    )
  })

  it('keeps the font a signature or pasted paragraph was written in', () => {
    const html = roundTrip(
      '<div><span style="font-size: 18px; font-family: Georgia">Asha</span></div>',
    )
    expect(html).toContain('font-size: 18px')
    expect(html).toContain('font-family: Georgia')
  })

  it('keeps a named colour in the form the send path resolves', () => {
    expect(roundTrip('<div><span style="color: #1579D0">x</span></div>')).toContain(
      'var(--prose-color-blue)',
    )
  })

  it('carries a quote through untouched, attributes included', () => {
    const quote =
      '<div class="frappe_mail_quote"><table width="600"><tbody><tr><td data-x="1">a</td></tr></tbody></table></div>'
    expect(roundTrip(`<div>Reply</div>${quote}`)).toContain(quote)
  })

  it('keeps a mention as the node the send path flattens', () => {
    expect(
      roundTrip(
        '<div><span data-type="mention" class="mention" data-id="a@x.test" data-label="Asha">@Asha</span></div>',
      ),
    ).toContain('data-id="a@x.test"')
  })

  it('sends a heading with nothing but its text', () => {
    const editor = new Editor({ extensions: composerExtensions(), content: '<div>Agenda</div>' })
    try {
      editor.commands.toggleHeading({ level: 3 })
      expect(editor.getHTML()).toContain('<h3>Agenda</h3>')
    } finally {
      editor.destroy()
    }
  })

  it('leaves the vacation message in paragraphs', () => {
    expect(roundTrip('<p>Away</p>', mailEditorKit({ divParagraphs: false }))).toBe('<p>Away</p>')
  })
})

describe('CustomImageExtension', () => {
  it('marks an uploaded image to go out inline', () => {
    expect(imageCid(roundTrip('<div><img src="/private/files/a.png"></div>'))).toBeTruthy()
  })

  it('leaves an image hosted elsewhere as a link', () => {
    expect(imageCid(roundTrip('<div><img src="https://x.test/a.png"></div>'))).toBeFalsy()
  })

  it('keeps the same inline id when a draft is reopened', () => {
    const saved = roundTrip('<div><img src="/private/files/a.png" data-cid="abc"></div>')
    expect(imageCid(saved)).toBe('abc')
    expect(imageCid(roundTrip(saved))).toBe('abc')
  })

  it('keeps an inline image inside the width of a phone', () => {
    const host = document.createElement('div')
    host.innerHTML = roundTrip('<div><img src="/files/a.png"></div>')
    expect(host.querySelector('img')?.style.maxWidth).toBe('100%')
  })
})
