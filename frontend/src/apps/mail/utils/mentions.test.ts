import * as cheerio from 'cheerio'
import { describe, expect, it } from 'vitest'

import { flattenMentions } from './mentions'

const flatten = (html: string) => {
  const $ = cheerio.load(html)
  flattenMentions($)
  return $('body').html() ?? ''
}

describe('flattenMentions', () => {
  it('sends a mention as a mailto link over its own text', () => {
    const html = flatten(
      '<p>hi <span class="mention" data-type="mention" data-id="s-aga-r@example.com" data-label="Sagar Sharma">@Sagar Sharma</span></p>',
    )

    expect(html).toContain('<a href="mailto:s-aga-r@example.com">@Sagar Sharma</a>')
    // None of the editor's internal markup survives — the recipient's client has
    // neither the class nor the node.
    expect(html).not.toContain('data-type="mention"')
    expect(html).not.toContain('class="mention"')
  })

  it('keeps the label escaped', () => {
    const html = flatten(
      '<p><span class="mention" data-type="mention" data-id="a@b.com" data-label="A &amp; B">@A &amp; B</span></p>',
    )

    expect(html).toContain('<a href="mailto:a@b.com">@A &amp; B</a>')
  })

  it('falls back to the label when the node carries no text', () => {
    const html = flatten(
      '<p><span class="mention" data-type="mention" data-id="a@b.com" data-label="A B"></span></p>',
    )

    expect(html).toContain('<a href="mailto:a@b.com">@A B</a>')
  })

  it('leaves a mention without an address alone', () => {
    const html = flatten('<p><span class="mention" data-type="mention">@nobody</span></p>')

    expect(html).toContain('<span class="mention" data-type="mention">@nobody</span>')
  })

  it('leaves the rest of the body untouched', () => {
    const html = flatten('<p>plain <a href="https://example.com">link</a> &amp; text</p>')

    expect(html).toBe('<p>plain <a href="https://example.com">link</a> &amp; text</p>')
  })
})
