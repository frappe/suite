import { afterEach, describe, expect, it, vi } from 'vitest'

import { documentTypes, findDocumentType } from './documentRegistry'

vi.mock('frappe-ui', () => ({ toast: {}, FileUploadHandler: class {} }))

function record(node: string) {
  return JSON.stringify({ node, keys: [] })
}

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

  describe('forgetting a node', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      localStorage.clear()
    })

    it("drops that node's offline presentation through the registered Slides type", async () => {
      vi.stubGlobal('caches', {
        open: async () => ({ delete: async () => true, keys: async () => [] }),
        has: async () => false,
        delete: async () => true,
      })
      localStorage.setItem('slides-offline-copy:p1', record('n1'))
      localStorage.setItem('slides-offline-copy:p2', record('n2'))

      findDocumentType('Presentation')?.forgetNode?.('n1')

      await vi.waitFor(() => expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull())
      expect(localStorage.getItem('slides-offline-copy:p2')).toBe(record('n2'))
    })
  })
})
