import { describe, expect, it } from 'vitest'

import { nodeIcon, nodeIconTint } from '@/apps/drive/files/internal/icons'
import { storageTypeIcon, storageTypeTint } from './storageTypes'

describe('storage type icons', () => {
  it('draws a type the way Drive draws a file of that type', () => {
    const deck = { kind: 'document', mime: 'frappe/slides', content_doctype: 'Presentation' } as const
    const photo = { kind: 'file', mime: 'image/png', content_doctype: null } as const
    const pdf = { kind: 'file', mime: 'application/pdf', content_doctype: null } as const
    const clip = { kind: 'file', mime: 'video/mp4', content_doctype: null } as const
    for (const [type, node] of [['Presentation', deck], ['Image', photo], ['PDF', pdf], ['Video', clip]] as const) {
      expect(storageTypeIcon(type)).toBe(nodeIcon(node))
      expect(storageTypeTint(type)).toBe(nodeIconTint(node))
    }
  })

  it('falls back to a plain gray file for a type it does not know', () => {
    expect(storageTypeIcon('Unknown')).toBe('lucide-file')
    expect(storageTypeTint('Unknown')).toBe(nodeIconTint({ kind: 'file', mime: null, content_doctype: null }))
  })
})
