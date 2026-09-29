import { describe, expect, it } from 'vitest'

import { nodeIcon } from '@/apps/drive/files/internal/icons'
import { largestFileNode, storageTypeIcon } from './storageTypes'

describe('storage breakdown icons', () => {
  it('draws a largest document with its content icon and a file by its mime', () => {
    const deck = { node: 'n1', title: 'Deck', size: 5, mime: 'frappe/slides', kind: 'document', type: 'Presentation' } as const
    const photo = { node: 'n2', title: 'a.png', size: 9, mime: 'image/png', kind: 'file', type: 'Image' } as const
    expect(nodeIcon(largestFileNode(deck))).toBe('lucide-presentation')
    expect(nodeIcon(largestFileNode(photo))).toBe('lucide-image')
  })

  it('names the same icon for a type row as for a file of that type', () => {
    expect(storageTypeIcon('Image')).toBe('lucide-image')
    expect(storageTypeIcon('Presentation')).toBe('lucide-presentation')
    expect(storageTypeIcon('Unknown')).toBe('lucide-file')
  })
})
