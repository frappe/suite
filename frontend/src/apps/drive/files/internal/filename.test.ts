import { describe, expect, it } from 'vitest'

import { titleExtension } from './filename'

describe('titleExtension', () => {
  it.each([
    ['Report.pdf', 'pdf'],
    ['Scan.PDF', 'PDF'],
    ['archive.tar.gz', 'gz'],
    ['README', null],
    ['.env', null],
    ['notes.', null],
    ['v1.2 notes', null],
    ['clip.verylongext', null],
    ['clip.tenletters', 'tenletters'],
  ])('%s has extension %s', (title, extension) => {
    expect(titleExtension(title)).toBe(extension)
  })
})
