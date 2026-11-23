import { describe, expect, it } from 'vitest'

import { conversionNotice } from './conversionNotice'

const REFUSED = "This presentation couldn't be upgraded, so it stays read-only."

describe('the notice on a refused presentation', () => {
  it.each([
    ['check', "the upgraded version didn't match the original"],
    ['check: html', "the upgraded version didn't match the original"],
    ['check: schema', "the upgraded version didn't match the original"],
    ['too_large', 'it is too large to edit together'],
    ['unreadable-yjs', "its saved changes couldn't be read"],
    ['over_quota', 'there is no storage space left'],
    ['child_timeout', 'the upgrade took too long'],
    ['child_crash', 'the upgrade stopped unexpectedly'],
    ['bad_answer', 'the upgrade gave an unreadable answer'],
  ])('says %s in plain words', (reason, words) => {
    expect(conversionNotice({ state: 'refused', reason })).toBe(`${REFUSED} Reason: ${words}.`)
  })

  it('leaves out a reason it has no words for', () => {
    expect(conversionNotice({ state: 'refused', reason: 'new_code: detail' })).toBe(REFUSED)
  })

  it('has no reason line when the reader gets no reason', () => {
    expect(conversionNotice({ state: 'refused' })).toBe(REFUSED)
  })
})
