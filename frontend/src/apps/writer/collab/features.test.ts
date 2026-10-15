import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { writerAdapter } from '@/apps/writer/collab/adapter'
import { writerSchema } from '@/apps/writer/schema'

type Features = {
  schema: number
  features: Record<string, number>
  nodes: string[]
  marks: string[]
}

// The server refuses a row naming anything this file does not declare at or below the row's schema
const featuresPath = resolve(__dirname, '../../../../../suite/writer/content/features.json')
const featuresText = readFileSync(featuresPath, 'utf8')
const declared = JSON.parse(featuresText) as Features

// The binding writes kept formatting back as the keys it was read from
const KEPT_FORMATTING = 'keptFormatting'

const editorNames = () => {
  const schema = getSchema(writerSchema())
  const names = new Set<string>()
  const marks = Object.values(schema.marks).filter((mark) => mark.name !== KEPT_FORMATTING)
  const types = [...Object.values(schema.nodes), ...marks]
  for (const type of types) {
    names.add(type.name)
    for (const attribute of Object.keys(type.spec.attrs ?? {})) {
      names.add(attribute)
    }
  }
  return names
}

describe('writer collab features', () => {
  it('declares every node, mark and attribute the editor can write', () => {
    const missing = [...editorNames()].filter((name) => !(name in declared.features))
    expect(missing).toEqual([])
  })

  it('lists the names the server takes as elements and as marks', () => {
    const schema = getSchema(writerSchema())
    // The binding makes no element for the document or for text
    const nodes = Object.keys(schema.nodes).filter((name) => name !== 'doc' && name !== 'text')
    expect(declared.nodes).toEqual(nodes.sort())
    const marks = Object.keys(schema.marks).filter((name) => name !== KEPT_FORMATTING)
    expect(declared.marks).toEqual(marks.sort())
  })

  it('has no mark that overlaps itself, so every mark key is a plain mark name', () => {
    const marks = Object.values(getSchema(writerSchema()).marks)
    const overlapping = marks.filter((mark) => !mark.excludes(mark)).map((mark) => mark.name)
    expect(overlapping).toEqual([])
  })

  it('declares the document roots and the tab label key', () => {
    for (const name of ['default', 'meta', 'firstTabLabel']) {
      expect(declared.features).toHaveProperty(name)
    }
  })

  it('introduces every name at a schema the server knows', () => {
    const versions = Object.values(declared.features)
    expect(versions.every((version) => Number.isInteger(version) && version >= 1)).toBe(true)
    expect(Math.max(...versions)).toBeLessThanOrEqual(declared.schema)
  })

  it('stamps pushes with the schema the server declares', () => {
    expect(writerAdapter.features.schema).toBe(declared.schema)
  })
})
