import { describe, expect, it } from 'vitest'

import { readVersions } from './versions'

describe('reading a versions page', () => {
  it('names whoever took a version by full name, and by user id when Drive sends no name', () => {
    const page = readVersions({
      rows: [
        {
          seq: 2,
          kind: 'auto',
          actor: 'theo@northwind.test',
          person: { full_name: 'Theo Williams' },
        },
        { seq: 1, kind: 'named', actor: 'maya@northwind.test' },
      ],
      next_cursor: null,
    })

    expect(page.rows.map((version) => version.actor)).toEqual([
      'Theo Williams',
      'maya@northwind.test',
    ])
  })
})
