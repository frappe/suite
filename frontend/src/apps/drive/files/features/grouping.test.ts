import { describe, expect, it } from 'vitest'
import { groupContiguous, groupingHeading } from './grouping'
import type { DriveNode } from '@/apps/drive/client/types'

const row = (name: string, kind: string, owner = 'A'): DriveNode => ({
  name, title: name, kind, owner, parent: 'p', root: 'r', state: 'Active', size: 0, mime: null,
  url: null, content_doctype: null, content_docname: null, is_template: 0, creation: null,
  modified: '2026-09-15T10:00:00', content_modified: null,
})

describe('group headings', () => {
  it('derives headings from row fields and preserves server order', () => {
    const rows = [row('folder', 'folder'), row('file', 'file'), row('b', 'file', 'B')]
    expect(groupContiguous(rows, 'owner').map((section) => section.heading)).toEqual(['A', 'B'])
    expect(groupingHeading(rows[0]!, 'type')).toBe('Folders')
  })
})

