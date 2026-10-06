import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { WRITER_SCHEMA } from '@/apps/writer/collab'
import { writerSchema } from '@/apps/writer/schema'

// The server refuses a row naming anything this file does not declare at or below the row's schema
const declared = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../suite/writer/collab/features.json'), 'utf8'),
) as { schema: number; features: Record<string, number> }

const editorNames = () => {
  const schema = getSchema(writerSchema())
  const names = new Set<string>()
  for (const type of [...Object.values(schema.nodes), ...Object.values(schema.marks)]) {
    names.add(type.name)
    for (const attribute of Object.keys(type.spec.attrs ?? {})) names.add(attribute)
  }
  return names
}

describe('writer collab features', () => {
  it('declares every node, mark and attribute the editor can write', () => {
    const missing = [...editorNames()].filter((name) => !(name in declared.features))
    expect(missing).toEqual([])
  })

  it('declares the document roots and the tab label key', () => {
    for (const name of ['default', 'meta', 'firstTabLabel'])
      expect(declared.features).toHaveProperty(name)
  })

  it('introduces every name at a schema the server knows', () => {
    const versions = Object.values(declared.features)
    expect(versions.every((version) => Number.isInteger(version) && version >= 1)).toBe(true)
    expect(Math.max(...versions)).toBeLessThanOrEqual(declared.schema)
  })

  it('stamps pushes with the schema the server declares', () => {
    expect(WRITER_SCHEMA).toBe(declared.schema)
  })
})
