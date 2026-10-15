import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import type { DocumentSession } from '@/apps/drive'
import { BODY_FIELD } from '@/apps/writer/collab'
import { writerSchema } from '@/apps/writer/schema'

import {
  imagesNotice,
  missingImages,
  restoreImages,
  versionImages,
  type MissingImage,
} from './versionImages'

const drive = vi.hoisted(() => ({
  nodes: new Map<string, object>(),
  query: vi.fn(),
  mutation: vi.fn(),
}))

vi.mock('@/api', () => ({
  api: { drive: { nodes: { media: 'media', get: 'get', batch: 'batch' } } },
  client: { query: drive.query, mutation: drive.mutation },
}))

function embed(id: string) {
  return '/api/method/suite.writer.api.embed.get?id=' + id
}

const refresh = vi.fn(async () => {})
const session = {
  nodeId: 'doc-1',
  credentials: { context: {} },
  media: () => ({ refresh }),
} as unknown as DocumentSession

function binned(name: string, title: string, role: number, trashRoot = name) {
  return { name, title, state: 'Trashed', trash_root: trashRoot, access: { role } }
}

beforeEach(() => {
  drive.nodes.clear()
  drive.query.mockReset().mockImplementation(async (route: string, input: { node: string }) => {
    if (route === 'media') {
      return { media: [{ node: 'here' }] }
    }

    const node = drive.nodes.get(input.node)
    if (!node) {
      throw Object.assign(new Error('not found'), { type: 'DriveNotFound' })
    }

    return node
  })
  drive.mutation.mockReset().mockResolvedValue({ ok: [], failed: [] })
  refresh.mockClear()
})

describe('versionImages', () => {
  it('reads the images a stored version shows, each once', () => {
    const schema = getSchema(writerSchema())
    const content = schema
      .nodeFromJSON({
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: embed('one'), alt: 'Chart' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'between' }] },
          { type: 'image', attrs: { src: embed('one') } },
          { type: 'image', attrs: { src: 'https://example.com/a.png' } },
        ],
      })
      .toJSON()
    const state = Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, content, BODY_FIELD))

    expect(versionImages({ lineage: 'l', state })).toEqual([{ id: 'one', alt: 'Chart' }])
  })

  it('reads the images of a version kept as HTML, in either spelling', () => {
    const first = embed('one')
    const html = `<p>x</p><img src="${first}" alt="Logo"><img data-node="two"><img src="/files/a.png">`

    expect(versionImages({ html })).toEqual([
      { id: 'one', alt: 'Logo' },
      { id: 'two', alt: '' },
    ])
  })
})

describe('missingImages', () => {
  it('sorts the missing images into ones this person may bring back and ones that show broken', async () => {
    drive.nodes.set('mine', binned('mine', 'mine.png', 50))
    drive.nodes.set('theirs', binned('theirs', 'theirs.png', 40))
    drive.nodes.set('with-doc', binned('with-doc', 'with-doc.png', 50, 'folder'))
    drive.nodes.set('moved', { name: 'moved', title: 'moved.png', state: 'Active' })
    const images = ['here', 'mine', 'theirs', 'with-doc', 'moved', 'gone'].map((id) => ({
      id,
      alt: id === 'gone' ? 'Old photo' : '',
    }))

    const missing = await missingImages(session, images)

    expect(missing).toEqual([
      { id: 'mine', name: 'mine.png', isBinned: true, canRestore: true },
      { id: 'theirs', name: 'theirs.png', isBinned: true, canRestore: false },
      { id: 'with-doc', name: 'with-doc.png', isBinned: true, canRestore: false },
      { id: 'gone', name: 'Old photo', isBinned: false, canRestore: false },
    ])
    const asked = drive.query.mock.calls
      .filter(([route]) => route === 'get')
      .map(([, input]) => input.node)
    expect(asked).not.toContain('here')
  })

  it('asks nothing for a version without images', async () => {
    expect(await missingImages(session, [])).toEqual([])
    expect(drive.query).not.toHaveBeenCalled()
  })

  it('stops on a failure other than a deleted image', async () => {
    drive.query.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 502 }))

    await expect(missingImages(session, [{ id: 'mine', alt: '' }])).rejects.toThrow('down')
  })
})

describe('restoreImages', () => {
  const missing: MissingImage[] = [
    { id: 'mine', name: 'mine.png', isBinned: true, canRestore: true },
    { id: 'theirs', name: 'theirs.png', isBinned: true, canRestore: false },
    { id: 'gone', name: '', isBinned: false, canRestore: false },
  ]

  it('takes out of the bin only what this person may, then reads the media again', async () => {
    await restoreImages(session, missing)

    expect(drive.mutation).toHaveBeenCalledWith(
      'batch',
      { nodes: ['mine'], patch: { state: 'Active' } },
      { context: {} },
    )
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('sends nothing when nothing may come back', async () => {
    await restoreImages(session, missing.slice(1))

    expect([drive.mutation.mock.calls.length, refresh.mock.calls.length]).toEqual([0, 0])
  })

  it('tells what comes back and what shows broken', () => {
    expect(imagesNotice(missing)).toBe(
      'These images are in the bin and come back with it: mine.png. ' +
        "These images will show broken: theirs.png (in the bin, and you can't restore it), " +
        'An image with no name (deleted).',
    )
    expect(imagesNotice([])).toBe('')
  })
})
