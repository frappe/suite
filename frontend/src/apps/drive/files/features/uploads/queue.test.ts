import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// An in-memory Drive server behind `fetch`, installed before any import so the
// platform transport sends every request here. It follows the upload contract
// of Drive §8.4 and the framework's chunk rules: sessions, chunks at an offset
// no later than what the server holds, and finish. With `direct` on, create
// answers an S3 presigned POST and a fake XHR plays the bucket.
const drive = vi.hoisted(() => {
  const MiB = 1024 * 1024
  type Node = { name: string; title: string; kind: string; parent: string | null; size: number }
  type Session = { parent: string; filename: string; size: number; replaces?: string; received: number; direct?: boolean }
  const state = {
    nodes: new Map<string, Node>(),
    sessions: new Map<string, Session>(),
    usage: { used: 0, quota: 0 },
    /** A limit only `POST /uploads` knows, as when usage is stale. */
    createLimit: Infinity,
    /** The site's per-file limit, which refuses one file and not the root. */
    fileLimit: Infinity,
    chunkOffsets: [] as number[],
    finished: [] as Array<Record<string, unknown>>,
    /** Create answers a direct target instead of a chunked session. */
    direct: false,
    /** Each form the bucket received: its field names in order, and the file size. */
    posts: [] as Array<{ url: string; fields: string[]; size: number }>,
    creates: 0,
    /** Runs before the server answers, as time passing between requests. */
    before: null as ((method: string, path: string) => Promise<void> | void) | null,
    nextId: 0,
  }
  const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status })
  const refuse = (status: number, error: Record<string, unknown>) =>
    new Response(JSON.stringify({ errors: [error] }), { status })
  const row = (node: Node) => ({
    ...node, root: 'root', state: 'Active', trash_root: null, mime: null, url: null, content_doctype: null, content_docname: null,
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
    await state.before?.(method, path)
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
      if (body.size > state.fileLimit) {
        return refuse(422, { type: 'DriveFileTooLarge', message: `Files can be up to ${state.fileLimit} B. This one is ${body.size} B.` })
      }
      const free = state.usage.quota ? state.usage.quota - state.usage.used : Infinity
      if (body.size > Math.min(free, state.createLimit)) {
        return refuse(413, { type: 'DriveOverQuota', message: 'This Drive is full.' })
      }
      const id = `u${state.nextId++}`
      state.creates += 1
      state.sessions.set(id, {
        parent: body.parent, filename: body.filename, size: body.size, replaces: body.replaces, received: 0, direct: state.direct,
      })
      if (state.direct) {
        return ok({ mode: 'direct', upload_id: id, url: 'https://bucket.test/', fields: { key: `uploads/${id}`, policy: 'p' } })
      }
      return ok({ mode: 'chunked', upload_id: id })
    }
    if (method === 'PUT' && (match = path.match(/^uploads\/([^/]+)\/chunk$/))) {
      const session = state.sessions.get(match[1]!)
      if (!session) return refuse(404, { type: 'DriveNotFound', message: 'Drive upload session was not found or has expired' })
      const offset = Number(parsed.searchParams.get('offset'))
      if (offset > session.received) return refuse(409, { type: 'DriveConflict', message: 'Offset ahead' })
      if (!(init.body instanceof Blob) || new Headers(init.headers).get('Content-Type') !== 'application/octet-stream') {
        return refuse(400, { type: 'ValidationError', message: 'A chunk is a raw body' })
      }
      if (init.body.size > 16 * MiB) return refuse(413, { type: 'ValidationError', message: 'Chunk too large' })
      if (init.body.size) state.chunkOffsets.push(offset)
      session.received = Math.max(session.received, offset + init.body.size)
      return ok({ upload_id: match[1], received: session.received })
    }
    if (method === 'POST' && (match = path.match(/^uploads\/([^/]+)\/finish$/))) {
      const session = state.sessions.get(match[1]!)!
      const body = json()
      if (!session.size) return refuse(417, { type: 'ValidationError', message: 'Upload session has no data' })
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

  // The bucket: a presigned POST with the policy fields first and the file last.
  class FakeXHR {
    status = 0
    responseText = ''
    upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    private url = ''
    open(_method: string, url: string) {
      this.url = url
    }
    abort() {}
    send(form: FormData) {
      const names = [...form.keys()]
      const bytes = form.get('file') as Blob
      const id = String(form.get('key')).replace('uploads/', '')
      setTimeout(() => {
        state.posts.push({ url: this.url, fields: names, size: bytes.size })
        this.upload.onprogress?.({ loaded: Math.floor(bytes.size / 2) })
        this.upload.onprogress?.({ loaded: bytes.size })
        const session = state.sessions.get(id)
        if (session) session.received = bytes.size
        this.status = 204
        this.onload?.()
      }, 0)
    }
  }
  globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest

  return {
    state,
    MiB,
    reset() {
      state.nodes.clear()
      state.sessions.clear()
      state.usage = { used: 0, quota: 0 }
      state.createLimit = Infinity
      state.fileLimit = Infinity
      state.chunkOffsets = []
      state.finished = []
      state.direct = false
      state.posts = []
      state.creates = 0
      state.before = null
      state.nodes.set('folder', { name: 'folder', title: 'Folder', kind: 'folder', parent: 'root', size: 0 })
    },
    add,
    titlesIn(parent: string) {
      return [...state.nodes.values()].filter((node) => node.parent === parent).map((node) => node.title).sort()
    },
  }
})

import { createUploadRecords, RECORD_LIFETIME_MS, type UploadOwner, type UploadRecord, type UploadRecords } from './records'
import { createUploadQueue, uploadTargetOf, type UploadPrompts, type UploadQueue } from './queue'

const target = { parent: 'folder', root: 'root' }
const file = (name: string, size: number, lastModified = 1000) =>
  new File([new Uint8Array(size).map((_, index) => index % 251)], name, { lastModified })

const ME: UploadOwner = { user: 'me@example.com', link: null }

function memoryRecords(): UploadRecords & { all: Map<string, UploadRecord> } {
  const all = new Map<string, UploadRecord>()
  return {
    all,
    load: async () => [...all.values()],
    save: async (record) => void all.set(record.upload_id, { ...record, owner: ME }),
    remove: async (id) => void all.delete(id),
    clear: async () => all.clear(),
  }
}

/** A record as a reload left it. */
const stored = (upload_id: string, size: number, fields: Partial<UploadRecord> = {}) => ({
  upload_id, mode: 'chunked' as const, parent: 'folder', name: 'draft.bin', size, lastModified: 4242,
  bytesSent: 0, createdAt: Date.now(), touchedAt: Date.now(), ...fields,
})

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

  it('starts a file once while its title question waits and other files finish', async () => {
    drive.add({ title: 'report.pdf', kind: 'file', parent: 'folder', size: 3 })
    const queue = createUploadQueue({ records: memoryRecords() })
    const asked = prompts({
      collision: async (input) => {
        asked.asked.push(`collision:${input.title}`)
        await until(() => queue.entries.value[1]?.state === 'done', 'the other file')
        return { action: 'keep-both', applyToAll: false }
      },
    })
    queue.setPrompts(asked)

    await queue.uploadFiles([{ file: file('report.pdf', 10) }, { file: file('notes.txt', 20) }], target)
    await settled(queue)

    expect(asked.asked).toEqual(['collision:report.pdf'])
    expect(drive.titlesIn('folder')).toEqual(['notes.txt', 'report (1).pdf', 'report.pdf'])
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

  it('fails only the file the site refuses as too large, and the others upload', async () => {
    drive.state.fileLimit = 50
    const queue = createUploadQueue({ records: memoryRecords(), parallel: 1, maxFileSize: () => null })
    queue.setPrompts(prompts())
    const tones: Array<string | undefined> = []
    drive.state.before = () => void tones.push(queue.indicator.value?.tone)

    await queue.uploadFiles([{ file: file('film.mov', 80) }, { file: file('a.txt', 10) }, { file: file('b.txt', 20) }], target)
    await settled(queue)

    const [film, ...rest] = queue.entries.value
    expect(film).toMatchObject({ state: 'failed', error: 'Files can be up to 50 B. This one is 80 B.', retryable: false })
    expect(rest.map((entry) => entry.state)).toEqual(['done', 'done'])
    expect(drive.titlesIn('folder')).toEqual(['a.txt', 'b.txt'])
    expect(queue.state.halted).toBeNull()
    expect(tones).not.toContain('paused')
  })

  it('refuses a file above the boot limit before any request, in the server\'s words', async () => {
    const queue = createUploadQueue({ records: memoryRecords(), maxFileSize: () => 1024 })
    queue.setPrompts(prompts())

    await queue.uploadFiles([{ file: file('over.bin', 1025) }, { file: file('fits.bin', 1024) }], target)
    await settled(queue)

    expect(queue.entries.value.map((entry) => [entry.state, entry.error])).toEqual([
      ['failed', 'Files can be up to 1 KB. This one is 1.1 KB.'],
      ['done', null],
    ])
    expect(drive.state.creates).toBe(1)
    expect(queue.state.halted).toBeNull()
  })

  it('resumes after a reload from the bytes the server holds, and proves the file with its sha256', async () => {
    const records = memoryRecords()
    const picked = file('draft.bin', 16 * drive.MiB + 100, 4242)
    drive.state.sessions.set('u-old', { parent: 'folder', filename: 'draft.bin', size: picked.size, received: 16 * drive.MiB })
    await records.save(stored('u-old', picked.size, { bytesSent: 16 * drive.MiB }))

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
    await records.save(stored('u-old', 10, { lastModified: 1, bytesSent: 4 }))
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

  it('asks the server where to go on: a record ahead of the server does not send a stale offset', async () => {
    const records = memoryRecords()
    const picked = file('draft.bin', 16 * drive.MiB + 100, 4242)
    drive.state.sessions.set('u-old', { parent: 'folder', filename: 'draft.bin', size: picked.size, received: 0 })
    await records.save(stored('u-old', picked.size, { bytesSent: 16 * drive.MiB }))
    const queue = createUploadQueue({ records })
    queue.setPrompts(prompts({ pickFile: async () => picked }))
    await queue.restore()

    await queue.resume(queue.entries.value[0]!.id)
    await settled(queue)

    expect(queue.entries.value.map((entry) => entry.state)).toEqual(['done'])
    expect(drive.state.chunkOffsets).toEqual([0, 16 * drive.MiB])
  })

  it('starts again, and says so, when the server lost the session', async () => {
    const records = memoryRecords()
    const picked = file('draft.bin', 50, 4242)
    await records.save(stored('u-gone', picked.size, { bytesSent: 20 }))
    const queue = createUploadQueue({ records })
    queue.setPrompts(prompts({ pickFile: async () => picked }))
    await queue.restore()

    await queue.resume(queue.entries.value[0]!.id)
    await settled(queue)

    const [entry] = queue.entries.value
    expect(entry).toMatchObject({ state: 'done', note: null })
    expect(drive.state.creates).toBe(1)
    expect(drive.state.chunkOffsets).toEqual([0])
    expect(drive.state.finished).toEqual([expect.not.objectContaining({ checksum: expect.anything() })])
    expect(records.all.has('u-gone')).toBe(false)
    expect(records.all.size).toBe(0)
  })

  it('shows the restart note while a lost session uploads again', async () => {
    const records = memoryRecords()
    await records.save(stored('u-gone', 5, { bytesSent: 2 }))
    const queue = createUploadQueue({ records })
    let release!: () => void
    queue.setPrompts(prompts({ pickFile: async () => file('draft.bin', 5, 4242) }))
    drive.state.createLimit = Infinity
    const gate = new Promise<void>((resolve) => (release = resolve))
    drive.state.before = (method, path) => (method === 'POST' && path === 'uploads' ? gate : undefined)
    await queue.restore()
    void queue.resume(queue.entries.value[0]!.id)
    await until(() => queue.entries.value[0]!.note !== null, 'the note')
    expect(queue.entries.value[0]!.note).toBe('The earlier upload expired. This file starts again.')
    release()
    await settled(queue)
  })

  it('a row Retry after a 413 starts the queue again', async () => {
    drive.state.createLimit = 50
    const queue = createUploadQueue({ records: memoryRecords(), parallel: 1 })
    queue.setPrompts(prompts())
    await queue.uploadFiles([{ file: file('one.bin', 80) }], target)
    await until(() => queue.state.halted !== null, 'the halt')

    drive.state.createLimit = Infinity
    queue.retry(queue.entries.value[0]!.id)
    await settled(queue)

    expect(queue.state.halted).toBeNull()
    expect(drive.titlesIn('folder')).toEqual(['one.bin'])
  })

  it('raises the red dot for a failure only while the tracker is closed', async () => {
    const queue = createUploadQueue({ records: memoryRecords() })
    queue.setPrompts(prompts())
    // An empty file fails at finish; it does not halt the queue.
    queue.openTracker()
    await queue.uploadFiles([{ file: new File([], '') }], target)
    await settled(queue)
    expect(queue.entries.value[0]!.state).toBe('failed')
    expect(queue.indicator.value?.attention ?? false).toBe(false)

    queue.closeTracker()
    queue.retry(queue.entries.value[0]!.id)
    await settled(queue)
    expect(queue.entries.value[0]!.state).toBe('failed')
    expect(queue.indicator.value?.attention).toBe(true)
  })

  it('sends a direct upload to the storage target in one form, with progress, then finishes', async () => {
    drive.state.direct = true
    const records = memoryRecords()
    const queue = createUploadQueue({ records })
    queue.setPrompts(prompts())
    const seen: number[] = []

    await queue.uploadFiles([{ file: file('photo.jpg', 40) }], target)
    const stop = setInterval(() => seen.push(queue.entries.value[0]!.sent), 0)
    await settled(queue)
    clearInterval(stop)

    expect(drive.state.posts).toEqual([{ url: 'https://bucket.test/', fields: ['key', 'policy', 'file'], size: 40 }])
    expect(drive.state.chunkOffsets).toEqual([])
    expect(drive.state.finished).toEqual([expect.objectContaining({ parent: 'folder', title: 'photo.jpg' })])
    expect(drive.titlesIn('folder')).toEqual(['photo.jpg'])
    expect(queue.entries.value[0]!.state).toBe('done')
    expect(records.all.size).toBe(0)
  })

  it('finishes a direct upload again under a free title without sending the bytes twice', async () => {
    drive.state.direct = true
    const queue = createUploadQueue({ records: memoryRecords() })
    queue.setPrompts(prompts())
    // The title is free at create and taken by the time the bytes arrive.
    drive.state.before = (_method, path) => {
      if (path.endsWith('/finish') && !drive.titlesIn('folder').includes('late.txt')) {
        drive.add({ title: 'late.txt', kind: 'file', parent: 'folder', size: 1 })
      }
    }
    await queue.uploadFiles([{ file: file('late.txt', 9) }], target)
    await settled(queue)

    expect(drive.state.posts).toHaveLength(1)
    expect(drive.titlesIn('folder')).toEqual(['late (1).txt', 'late.txt'])
  })

  it('starts an interrupted direct upload again, and says so', async () => {
    drive.state.direct = true
    const records = memoryRecords()
    await records.save(stored('u-direct', 12, { mode: 'direct', bytesSent: 6 }))
    const queue = createUploadQueue({ records })
    queue.setPrompts(prompts({ pickFile: async () => file('draft.bin', 12, 4242) }))
    await queue.restore()

    expect(queue.entries.value[0]).toMatchObject({
      state: 'interrupted',
      sent: 0,
      note: 'This upload cannot continue where it stopped. It starts again.',
    })
    await queue.resume(queue.entries.value[0]!.id)
    await settled(queue)

    expect(drive.state.creates).toBe(1)
    expect(drive.state.posts).toHaveLength(1)
    expect(queue.entries.value[0]!.state).toBe('done')
    expect(records.all.size).toBe(0)
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
  const record = (upload_id: string, at: number, parent = 'folder') => ({
    upload_id, mode: 'chunked' as const, parent, name: 'a.bin', size: 1, lastModified: 1, bytesSent: 0,
    createdAt: at, touchedAt: at,
  })

  beforeEach(() => createUploadRecords({ owner: () => ME }).clear())

  it('keeps a record for 24 hours after its last write, then drops it', async () => {
    let now = 1_000_000
    const records = createUploadRecords({ now: () => now, owner: () => ME })
    await records.save(record('u1', now))

    now += RECORD_LIFETIME_MS - 1
    await records.save({ ...record('u1', 1_000_000), touchedAt: now })
    now += RECORD_LIFETIME_MS - 1
    expect((await records.load()).map((found) => found.upload_id)).toEqual(['u1'])
    now += 1
    expect(await records.load()).toEqual([])
  })

  it("never shows one user's records to another, and deletes them", async () => {
    let owner: UploadOwner = { user: 'alice@example.com', link: null }
    const records = createUploadRecords({ owner: () => owner })
    await records.save(record('alice-upload', Date.now()))

    owner = { user: 'bob@example.com', link: null }
    expect(await records.load()).toEqual([])
    owner = { user: 'alice@example.com', link: null }
    expect(await records.load()).toEqual([])
  })

  it("shows a guest's record only through the link that reached its folder", async () => {
    let owner: UploadOwner = { user: 'Guest', link: 'LINKA' }
    const records = createUploadRecords({ owner: () => owner })
    await records.save(record('guest-upload', Date.now()))

    owner = { user: 'Guest', link: 'LINKB' }
    expect(await records.load()).toEqual([])
    owner = { user: 'Guest', link: 'LINKA' }
    expect((await records.load()).map((found) => found.upload_id)).toEqual(['guest-upload'])
  })

  it('sign out forgets every entry and record of the queue', async () => {
    const records = createUploadRecords({ owner: () => ME })
    await records.save(record('mine', Date.now()))
    const queue = createUploadQueue({ records })
    await queue.restore()
    expect(queue.entries.value).toHaveLength(1)

    await queue.forget()

    expect(queue.entries.value).toEqual([])
    expect(await records.load()).toEqual([])
  })
})

describe('Upload targets', () => {
  const folder = (kind: string, role: number, state = 'Active') => ({ name: 'f1', root: 'r1', kind, state, access: { role } })

  it('takes uploads only into an Active folder or root where the caller has UPLOAD', () => {
    expect(uploadTargetOf(folder('folder', 30))).toEqual({ parent: 'f1', root: 'r1' })
    expect(uploadTargetOf(folder('root', 50))).toEqual({ parent: 'f1', root: 'r1' })
    // A comment-only link reader, a file row, and a folder not loaded yet take none.
    expect(uploadTargetOf(folder('folder', 20))).toBeNull()
    expect(uploadTargetOf(folder('file', 50))).toBeNull()
    expect(uploadTargetOf(undefined)).toBeNull()
    // The server creates files only below an Active container.
    expect(uploadTargetOf(folder('folder', 50, 'Trashed'))).toBeNull()
  })
})
