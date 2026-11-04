import { describe, expect, it, vi } from 'vitest'

import type { CredentialGrouper } from '@/apps/drive'
import type { RequestContext } from '@/platform/transport'

import {
  CompositeGroupLoader,
  indexOfPlace,
  mergeCompositeSlides,
  placeAt,
  type CompositeItem,
  type CompositeManifest,
} from './compositeGroups'

const context = (): RequestContext => ({ partition: () => 'test', scope: () => ({}) })

const manifest: CompositeManifest = {
  presentation: 'deck',
  node: 'node',
  modified: '2026-09-15',
  group_limit: 2,
  references: [
    { reference: 'a', index: 1, presentation: 'A', node: 'node-a' },
    { reference: 'b', index: 2, presentation: 'B', node: 'node-b' },
    { reference: 'c', index: 3, presentation: 'C', node: 'node-c' },
  ],
}

describe('composite group loading', () => {
  it('keeps manifest order when one group fails and retries only that group', async () => {
    const grouper = {
      group: vi.fn((ids: readonly string[]) => [
        { nodeIds: [...ids], fetch: vi.fn(), context: context() },
      ]),
      context: context(),
    }
    let fail = true
    const request = vi.fn(async (references: string[]) => {
      if (references.includes('c') && fail) throw new Error('offline')
      return {
        references: references.map((reference) => ({
          reference,
          index: manifest.references.find((row) => row.reference === reference)!.index,
          presentation: reference.toUpperCase(),
          readable: reference !== 'b',
          node: reference === 'b' ? null : `node-${reference}`,
          composite: reference === 'b' ? null : false,
          slides: reference === 'b' ? null : [{ name: `slide-${reference}` }],
        })),
      }
    })
    const loader = new CompositeGroupLoader(manifest, grouper, request)

    await loader.load()
    expect(loader.items.map((item) => [item.reference, item.status])).toEqual([
      ['a', 'ready'],
      ['b', 'unreadable'],
      ['c', 'failed'],
    ])
    expect(mergeCompositeSlides(loader.items).map((item) => [item.reference, item.status])).toEqual(
      [
        ['a', 'ready'],
        ['b', 'unreadable'],
        ['c', 'failed'],
      ],
    )

    fail = false
    await loader.retry(1)
    expect(loader.items.map((item) => [item.reference, item.status])).toEqual([
      ['a', 'ready'],
      ['b', 'unreadable'],
      ['c', 'ready'],
    ])
  })

  it("selects link codes by each reference's node and asks for the references themselves", async () => {
    // A grouper holding one code per node, with room for two codes a request.
    const sentWith = new Map<RequestContext, string[]>()
    const grouper: Pick<CredentialGrouper, 'group' | 'context'> = {
      group: (nodes) => {
        const groups = []
        for (let start = 0; start < nodes.length; start += 2) {
          const nodeIds = nodes.slice(start, start + 2)
          const requestContext = context()
          const fetch = vi.fn()
          sentWith.set(requestContext, nodeIds)
          groups.push({ nodeIds, fetch, context: requestContext })
        }
        return groups
      },
      context: context(),
    }
    const deck: CompositeManifest = {
      ...manifest,
      group_limit: 19,
      references: [
        { reference: 'r1', index: 1, presentation: 'A', node: 'node-a' },
        { reference: 'r2', index: 2, presentation: null, node: null },
        { reference: 'r3', index: 3, presentation: 'B', node: 'node-b' },
        { reference: 'r4', index: 4, presentation: 'C', node: 'node-c' },
      ],
    }
    const asked: Array<{ references: string[]; codesFor: string[] }> = []
    const request = vi.fn(async (references: string[], send: RequestContext) => {
      asked.push({ references, codesFor: sentWith.get(send) ?? [] })
      return {
        references: references.map((reference) => ({
          ...deck.references.find((row) => row.reference === reference)!,
          readable: reference !== 'r2',
          composite: false,
          slides: [],
        })),
      }
    })

    await new CompositeGroupLoader(deck, grouper, request).load()

    expect(asked).toEqual([
      { references: ['r1', 'r2', 'r3'], codesFor: ['node-a', 'node-b'] },
      { references: ['r4'], codesFor: ['node-c'] },
    ])
  })

  it('keeps the viewer on the same slide while later groups arrive', () => {
    const item = (reference: string, index: number, slides: number | null): CompositeItem => ({
      reference,
      index,
      presentation: reference.toUpperCase(),
      node: `node-${reference}`,
      status: slides === null ? 'loading' : 'ready',
      answer:
        slides === null
          ? undefined
          : {
              reference,
              index,
              presentation: reference.toUpperCase(),
              readable: true,
              node: `node-${reference}`,
              composite: false,
              slides: Array.from({ length: slides }, (_, slide) => ({
                name: `${reference}${slide}`,
              })),
            },
    })
    // The viewer reads the second slide of B while A is still a placeholder.
    const before = mergeCompositeSlides([item('a', 1, null), item('b', 2, 3)])
    const place = placeAt(before, 2)!

    const after = mergeCompositeSlides([item('a', 1, 4), item('b', 2, 3)])

    expect(place).toEqual({ reference: 'b', offset: 1 })
    expect(after[indexOfPlace(after, place)]!.slide).toEqual({ name: 'b1' })
    expect(indexOfPlace(after, { reference: 'gone', offset: 0 })).toBe(0)
  })
})
