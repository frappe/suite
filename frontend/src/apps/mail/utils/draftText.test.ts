import { describe, expect, it } from 'vitest'

import { writtenText } from './draftText'

// A reply as the composer saves it: what was written, two blank lines, then the signature.
const signature = '<p>Best,<br>Maya</p>'
const saved = (written: string) =>
  `${written}<div><br></div><div><br></div><div class="frappe_mail_signature">${signature}</div>`

describe("a draft's written text", () => {
  it('is what was written, a line for each line, without the signature under it', () => {
    expect(writtenText(saved('<p>Running late.</p><p>Start without me</p>'), signature)).toBe(
      'Running late.\nStart without me',
    )
  })

  it('is nothing when only the signature is there', () => {
    expect(writtenText(saved('<p></p>'), signature)).toBe('')
  })

  it('keeps a name signed by hand, which is only the end of the signature', () => {
    expect(writtenText('<p>See you there</p><p>Maya</p>', signature)).toBe('See you there\nMaya')
  })
})
