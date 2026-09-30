import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// An in-memory Drive server behind `fetch`, installed before any import so the
// platform transport sends every request here. It follows the upload contract
// of Drive §8.4: sessions, chunks at the offset the server holds, and finish.
const drive = vi.hoisted(() => {
  const MiB = 1024 * 1024
  type Node = { name: string; title: string; kind: string; parent: string | null; size: number }
  type Session = { parent: string; filename: string; size: number; replaces?: string; received: number }
  const state = {
    nodes: new Map<string, Node>(),
    sessions: new Map<string, Session>(),
    usage: { used: 0, quota: 0 },
    /** A limit only `POST /uploads` knows, as when usage is stale. */
    createLimit: Infinity,
    chunkOffsets: [] as number[],
    finished: [] as Array<Record<string, unknown>>,
    nextId: 0,
  }
  const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status })
  const refuse = (status: number, error: Record<string, unknown>) =>
    new Response(JSON.stringify({ errors: [error] }), { status })
  const row = (node: Node) => ({
    ...node, root: 'root', state: 'Active', mime: null, url: null, content_doctype: null, content_docname: null,
    is_template: 0, owner: 'owner@example.com', creation: null, modified: `m${state.nextId++}`, content_modified: null,
    access: { role: 40, via_link: null },
  })
  const taken = (parent: string, title: string) =>
    [...state.nodes.values()].find((node) => node.parent === parent && node.title === title)
  const freeTitle = (parent: string, title: string) => {
    const dot = title.lastIndexOf('.')
    const [stem, ext] = dot > 0 ? [title.slice(0, dot), title.slice(dot)] : [title, '']
    for (let index = 1; ; index++) {
      const candidate = `${stem} (${index})${ext}`
      if (!taken(parent, candidate)) return candidate
    }
  }
  const conflict = (parent: string, title: string) =>
    refuse(409, { type: 'DriveConflict', message: `${title} exists`, free_title: freeTitle(parent, title) })
  const add = (node: Omit<Node, 'name'>) => {
    const created = { ...node, name: `n${state.nextId++}` }
    state.nodes.set(created.name, created)
    return created
  }

  globalThis.fetch = async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const parsed = new URL(String(url), 'http://drive.test')
    const path = parsed.pathname.replace('/api/suite/drive/', '')
    const method = init.method ?? 'GET'
    const json = () => JSON.parse(String(init.body ?? '{}')) as Record<string, string & number>
    let match: RegExpMatchArray | null
    if (method === 'GET' && (match = path.match(/^roots\/([^/]+)\/usage$/))) {
      return ok({ used_bytes: state.usage.used, reserved_bytes: 0, quota_bytes: null, effective_quota: state.usage.quota })
    }
    if (method === 'GET' && (match = path.match(/^nodes\/([^/]+)\/children$/))) {
      const rows = [...state.nodes.values()].filter((node) => node.parent === match![1]).map(row)
      return ok({ rows, next_cursor: null })
    }
    if (method === 'POST' && path === 'nodes') {
      const body = json()
      if (taken(body.parent, body.title)) return conflict(body.parent, body.title)
      return ok(row(add({ title: body.title, kind: body.kind, parent: body.parent, size: 0 })))
    }
    if (method === 'POST' && path === 'uploads') {
      const body = json()
      if (!body.replaces && taken(body.parent, body.filename)) return conflict(body.parent, body.filename)
      const free = state.usage.quota ? state.usage.quota - state.usage.used : Infinity
      if (body.size > Math.min(free, state.createLimit)) {
        return refuse(413, { type: 'DriveOverQuota', message: 'This Drive is full.' })
      }
      const id = `u${state.nextId++}`
      state.sessions.set(id, { parent: body.parent, filename: body.filename, size: body.size, replaces: body.replaces, received: 0 })
      return ok({ mode: 'chunked', upload_id: id })
    }
    if (method === 'PUT' && (match = path.match(/^uploads\/([^/]+)\/chunk$/))) {
      const session = state.sessions.get(match[1]!)!
      const offset = Number(parsed.searchParams.get('offset'))
      if (offset > session.received) return refuse(409, { type: 'DriveConflict', message: 'Offset ahead' })
      if (!(init.body instanceof Blob) || new Headers(init.headers).get('Content-Type') !== 'application/octet-stream') {
        return refuse(400, { type: 'ValidationError', message: 'A chunk is a raw body' })
      }
      if (init.body.size > 16 * MiB) return refuse(413, { type: 'ValidationError', message: 'Chunk too large' })
      state.chunkOffsets.push(offset)
      session.received = offset + init.body.size
      return ok({ upload_id: match[1], received: session.received })
    }
    if (method === 'POST' && (match = path.match(/^uploads\/([^/]+)\/finish$/))) {
      const session = state.sessions.get(match[1]!)!
      const body = json()
      if (session.received !== session.size) return refuse(409, { type: 'DriveConflict', message: 'Bytes missing' })
      if (body.replaces) {
        const node = state.nodes.get(body.replaces)!
        node.size = session.size
        state.finished.push({ ...body, session: match[1] })
        state.sessions.delete(match[1]!)
        return ok(row(node))
      }
      if (taken(body.parent, body.title)) return conflict(body.parent, body.title)
      state.finished.push({ ...body, session: match[1] })
      state.sessions.delete(match[1]!)
      state.usage.used += session.size
      return ok(row(add({ title: body.title, kind: 'file', parent: body.parent, size: session.size })))
    }
    return refuse(404, { type: 'NotFound', message: `${method} ${path}` })
  }

  return {
    state,
    MiB,
    reset() {
      state.nodes.clear()
      state.sessions.clear()
      state.usage = { used: 0, quota: 0 }
      state.createLimit = Infinity
      state.chunkOffsets = []
      state.finished = []
      state.nodes.set('folder', { name: 'folder', title: 'Folder', kind: 'folder', parent: 'root', size: 0 })
    },
    add,
    titlesIn(parent: string) {
      return [...state.nodes.values()].filter((node) => node.parent === parent).map((node) => node.title).sort()
    },
  }
})

import { createUploadRecords, RECORD_LIFETIME_MS, type UploadRecord, type UploadRecords } from './records'
import { createUploadQueue, type UploadPrompts, type UploadQueue } from './queue'

const target = { parent: 'folder', root: 'root' }
const file = (name: string, size: number, lastModified = 1000) =>
  new File([new Uint8Array(size).map((_, index) => index % 251)], name, { lastModified })

function memoryRecords(): UploadRecords & { all: Map<string, UploadRecord> } {
  const all = new Map<string, UploadRecord>()
  return {
    all,
    load: async () => [...all.values()],
    save: async (record) => void all.set(record.upload_id, { ...record }),
    remove: async (id) => void all.delete(id),
  }
}

function prompts(overrides: Partial<UploadPrompts> = {}): UploadPrompts & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    collision: async (input) => {
      asked.push(`collision:${input.title}`)
      return { action: 'keep-both', applyToAll: false }
    },
    folderCollision: async ({ title }) => {
      asked.push(`folder:${title}`)
      return 'keep-both'
    },
    quota: async ({ fitting, count }) => {
      asked.push(`quota:${fitting}/${count}`)
      return 'fit'
    },
    pickFile: async () => null,
    ...overrides,
  }
}

async function until(check: () => boolean, what = 'condition') {
  for (let tries = 0; tries < 400; tries++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

const settled = (queue: UploadQueue) =>
  until(() => queue.entries.value.every((entry) => !['queued', 'checking', 'uploading'].includes(entry.state)), 'the queue to settle')

beforeEach(() => drive.reset())

describe('Drive upload queue', () => {
  it('uploads a batch, asks about a taken title, and keeps both', async () => {
    drive.add({ title: 'report.pdf', kind: 'file', parent: 'folder', size: 3 })
    const queue = createUploadQueue({ records: memoryRecords() })
    const asked = prompts()
    queue.setPrompts(asked)

    await queue.uploadFiles([{ file: file('report.pdf', 10) }, { file: file('notes.txt', 20) }], target)
    await settled(queue)

    expect(asked.asked).toEqual(['collision:report.pdf'])
    expect(drive.titlesIn('folder')).toEqual(['notes.txt', 'report (1).pdf', 'report.pdf'])
    expect(queue.entries.value.map((entry) => entry.state)).toEqual(['done', 'done'])
    expect(queue.indicator.value).toMatchObject({ fraction: 1, tone: 'done' })
  })

  it('asks once when the user applies a choice to the whole batch, and replaces in place', async () => {
    const a = drive.add({ title: 'a.txt', kind: 'file', parent: 'folder', size: 1 })
    const b = drive.add({ title: 'b.txt', kind: 'file', parent: 'folder', size: 1 })
    const queue = createUploadQueue({ records: memoryRecords(), parallel: 1 })
    const asked = prompts({
      collision: async (input) => {
        asked.asked.push(`collision:${input.title}:${input.canReplace}:${input.batch}`)
        return { action: 'replace', applyToAll: true }
      },
    })
    queue.setPrompts(asked)

    await queue.uploadFiles([{ file: file('a.txt', 5) }, { file: file('b.txt', 7) }], target)
    await settled(queue)

    expect(asked.asked).toEqual(['collision:a.txt:true:true'])
    expect(drive.titlesIn('folder')).toEqual(['a.txt', 'b.txt'])
    expect([drive.state.nodes.get(a.name)!.size, drive.state.nodes.get(b.name)!.size]).toEqual([5, 7])
  })

  it('sends a large file in 16 MiB chunks, one after another', async () => {
    const queue = createUploadQueue({ records: memoryRecords() })
    queue.setPrompts(prompts())

    await queue.uploadFiles([{ file: file('video.mp4', 16 * drive.MiB + 5) }], target)
    await settled(queue)

    expect(drive.state.chunkOffsets).toEqual([0, 16 * drive.MiB])
    expect(drive.titlesIn('folder')).toEqual(['video.mp4'])
  })

  it('offers to upload what fits when the root is short of space', async () => {
    drive.state.usage = { used: 900, quota: 1000 }
    const queue = createUploadQueue({ records: memoryRecords() })
    const asked = prompts()
    queue.setPrompts(asked)

    await queue.uploadFiles([{ file: file('big.bin', 150) }, { file: file('small.bin', 60) }], target)
    await settled(queue)

    expect(asked.asked).toEqual(['quota:1/2'])
    expect(drive.titlesIn('folder')).toEqual(['small.bin'])
  })

  it('stops the queue on a 413 and starts it again with Retry all', async () => {
    drive.state.createLimit = 50
    const queue = createUploadQueue({ records: memoryRecords(), parallel: 1 })
    queue.setPrompts(prompts())

    await queue.uploadFiles([{ file: file('one.bin', 80) }, { file: file('two.bin', 10) }], target)
    await until(() => queue.state.halted !== null, 'the halt')

    expect(queue.state.halted).toBe('This Drive is full.')
    expect(queue.entries.value.map((entry) => entry.state)).toEqual(['held', 'queued'])
    expect(queue.indicator.value).toMatchObject({ tone: 'paused' })

    drive.state.createLimit = Infinity
    queue.retryAll()
    await settled(queue)

    expect(queue.state.halted).toBeNull()
    expect(drive.titlesIn('folder')).toEqual(['one.bin', 'two.bin'])
  })

  it('resumes after a reload from the bytes the server holds, and proves the file with its sha256', async () => {
    const records = memoryRecords()
    const picked = file('draft.bin', 16 * drive.MiB + 100, 4242)
    drive.state.sessions.set('u-old', { parent: 'folder', filename: 'draft.bin', size: picked.size, received: 16 * drive.MiB })
    await records.save({
      upload_id: 'u-old', parent: 'folder', name: 'draft.bin', size: picked.size, lastModified: 4242,
      bytesSent: 16 * drive.MiB, createdAt: Date.now(),
    })

    const queue = createUploadQueue({ records })
    queue.setPrompts(prompts({ pickFile: async () => picked }))
    await queue.restore()

    expect(queue.entries.value.map((entry) => entry.state)).toEqual(['interrupted'])
    expect(queue.indicator.value?.attention).toBe(true)

    await queue.resume(queue.entries.value[0]!.id)
    await settled(queue)

    const expected = createHash('sha256').update(new Uint8Array(await picked.arrayBuffer())).digest('hex')
    expect(drive.state.chunkOffsets).toEqual([16 * drive.MiB])
    expect(drive.state.finished).toEqual([expect.objectContaining({ session: 'u-old', checksum: expected })])
    expect(records.all.size).toBe(0)
  })

  it('starts a new upload when the picked file is not the interrupted one', async () => {
    const records = memoryRecords()
    await records.save({
      upload_id: 'u-old', parent: 'folder', name: 'draft.bin', size: 10, lastModified: 1, bytesSent: 4, createdAt: Date.now(),
    })
    drive.state.sessions.set('u-old', { parent: 'folder', filename: 'draft.bin', size: 10, received: 4 })
    const queue = createUploadQueue({ records })
    queue.setPrompts(prompts({ pickFile: async () => file('draft.bin', 10, 99) }))
    await queue.restore()

    await queue.resume(queue.entries.value[0]!.id)
    await settled(queue)

    expect(queue.entries.value.map((entry) => entry.state)).toEqual(['interrupted', 'done'])
    expect(drive.state.sessions.get('u-old')?.received).toBe(4)
    expect(drive.state.finished).toEqual([expect.not.objectContaining({ checksum: expect.anything() })])
  })

  it('creates a folder tree top-down, and keeps both when the top folder exists', async () => {
    drive.add({ title: 'photos', kind: 'folder', parent: 'folder', size: 0 })
    const queue = createUploadQueue({ records: memoryRecords() })
    const asked = prompts()
    queue.setPrompts(asked)

    await queue.uploadFolders(
      [{
        title: 'photos',
        folders: ['2024', '2024/june'],
        files: [
          { folder: '', file: file('cover.jpg', 3) },
          { folder: '2024/june', file: file('beach.jpg', 4) },
        ],
      }],
      target,
    )
    await settled(queue)

    expect(asked.asked).toEqual(['folder:photos'])
    const top = [...drive.state.nodes.values()].find((node) => node.title === 'photos (1)')!
    expect(drive.titlesIn(top.name)).toEqual(['2024', 'cover.jpg'])
    const year = [...drive.state.nodes.values()].find((node) => node.title === '2024')!
    const june = [...drive.state.nodes.values()].find((node) => node.title === 'june')!
    expect(june.parent).toBe(year.name)
    expect(drive.titlesIn(june.name)).toEqual(['beach.jpg'])
  })
})

describe('Upload records', () => {
  it('keeps a record for 24 hours, then drops it', async () => {
    let now = 1_000_000
    const records = createUploadRecords(() => now)
    const record = {
      upload_id: 'u1', parent: 'folder', name: 'a.bin', size: 1, lastModified: 1, bytesSent: 0, createdAt: now,
    }
    await records.save(record)

    now += RECORD_LIFETIME_MS - 1
    expect(await records.load()).toEqual([record])
    now += 1
    expect(await records.load()).toEqual([])
  })
})
