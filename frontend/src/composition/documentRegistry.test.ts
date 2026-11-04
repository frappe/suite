import { describe, expect, it } from 'vitest'

import { documentTypes, findDocumentType } from './documentRegistry'

describe('document registry', () => {
  it('keeps Writer, Sheets, Slides and Draw in product order', () => {
    expect(documentTypes.map((definition) => definition.contentDoctype)).toEqual([
      'Writer Document',
      'Sheet',
      'Presentation',
      'Drawing',
    ])
  })

  it('finds the definition by the stored content doctype', () => {
    expect(findDocumentType('Sheet')).toBe(documentTypes[1])
    expect(findDocumentType('Spreadsheet')).toBeUndefined()
  })
})
