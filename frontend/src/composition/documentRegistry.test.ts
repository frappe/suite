import { describe, expect, it } from 'vitest'

import { documentTypes, findDocumentType } from './documentRegistry'

describe('document registry', () => {
  it('finds the definition by the stored content doctype', () => {
    expect(findDocumentType('Sheet')).toBe(documentTypes[1])
    expect(findDocumentType('Spreadsheet')).toBeUndefined()
  })
})
