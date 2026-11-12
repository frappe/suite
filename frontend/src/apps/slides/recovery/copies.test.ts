import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { elementText, writeDeck } from '@/apps/slides/collab/deck'
import { keepRecovery } from '@/apps/slides/surface/recovery'
import { openDraftsDb } from '@/apps/slides/utils/drafts'
import { DRAFTS_DB_NAME, draftsDbName } from '@/apps/slides/utils/slidesCaches'
import { openSignedInDeviceStore } from '@/platform/collab'

import { copyEntries, discardCopy, downloadCopy, listCopies, oldDraftCopies } from './copies'

const query = vi.hoisted(() => vi.fn())
vi.mock('@/api', () => ({
  api: { slides: { recovery: { names: 'recovery.names' } } },
  client: { query },
}))

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

let sessionUser: string | null = 'me@example.com'
vi.mock('@/platform/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/session')>()),
  getCookieSessionUser: () => sessionUser,
}))

const SLIDES = [{ name: 'row-1', elements: [{ type: 'text', content: 'Kept words' }] }]
const PLAN = {
  presentation: 'deck-plan',
  node: 'node-plan',
  title: 'Quarterly Plan',
  can_edit: true,
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function putDraft(record: Record<string, unknown>, user = 'me@example.com') {
  const db = await openDraftsDb(draftsDbName(user))
  await requestResult(
    db.transaction('presentations', 'readwrite').objectStore('presentations').put(record),
  )
  db.close()
}

async function draftIds(user = 'me@example.com') {
  const db = await openDraftsDb(draftsDbName(user))
  const keys = await requestResult(
    db.transaction('presentations').objectStore('presentations').getAllKeys(),
  )
  db.close()
  return keys
}

function draft(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    user: 'me@example.com',
    content: SLIDES,
    updatedAt: 1_700_000_000_000,
    dirty: true,
    ...fields,
  }
}

async function keepInRoomStore(node: string, title: string, words?: string) {
  const store = (await openSignedInDeviceStore('slides'))!
  const doc = new Y.Doc()
  writeDeck(doc, [{ id: 'one', elements: [{ id: 'title', type: 'text' }] }])
  if (words) {
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText(words)])
    elementText(doc, 'title')!.insert(0, [paragraph])
  }
  const state = Y.encodeStateAsUpdate(doc)
  await store.saveSession({ doc: node, sid: 's', lineage: 'L', cid: 1, bound: true })
  const entry = { doc: node, sid: 's', seq: 1, bytes: state, sha: '' }
  await store.recover(node, ['s'], 'schema', [entry], { state, title })
}

beforeEach(() => {
  localStorage.clear()
  sessionUser = 'me@example.com'
  query.mockReset()
  query.mockResolvedValue([PLAN])
})

afterEach(async () => {
  for (const user of ['me@example.com', 'other@example.com', 'Guest']) {
    sessionUser = user === 'Guest' ? null : user
    const copies = await listCopies()
    await Promise.all(copies.map(discardCopy))
  }
})

describe('old drafts as recovery copies (Q16)', () => {
  it('lists a dirty draft under its presentation title, and deletes a clean one', async () => {
    await putDraft(draft('deck-plan'))
    await putDraft(draft('deck-saved', { dirty: false }))

    const copies = await listCopies()

    expect(copies.map((copy) => [copy.node, copy.title, copy.slides])).toEqual([
      ['node-plan', 'Quarterly Plan', SLIDES],
    ])
    expect(await draftIds()).toEqual(['deck-plan'])
  })

  it('asks the server for the draft presentations in one read', async () => {
    await putDraft(draft('deck-plan'))
    await putDraft(draft('deck-other'))

    await listCopies()

    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]![1].presentations.sort()).toEqual(['deck-other', 'deck-plan'])
  })

  it('lists a draft the server names no title for as untitled, with nowhere to open', async () => {
    query.mockResolvedValue([])
    await putDraft(draft('deck-hidden'))

    const [copy] = await listCopies()

    expect([copy!.node, copy!.title]).toEqual([null, ''])
  })

  it('still lists the draft when the server read fails', async () => {
    query.mockRejectedValue(new Error('offline'))
    await putDraft(draft('deck-plan'))

    expect(await listCopies()).toHaveLength(1)
  })

  it('leaves out a draft another person of this browser left, and keeps it', async () => {
    await putDraft(draft('deck-plan', { user: 'other@example.com' }))

    expect(await listCopies()).toEqual([])
    expect(await draftIds()).toEqual(['deck-plan'])
  })

  it('deletes a retired draft, whose edits went to a copy already', async () => {
    await putDraft(draft('deck-plan', { dirty: false, retired: true }))

    expect(await listCopies()).toEqual([])
    expect(await draftIds()).toEqual([])
  })

  it("lists a guest's draft, which names no one, to the guest", async () => {
    sessionUser = null
    await putDraft(draft('deck-plan', { user: null }), 'Guest')

    expect(await listCopies()).toHaveLength(1)
  })

  it("gives one presentation's dirty draft as its copy, and deletes its clean one", async () => {
    await putDraft(draft('deck-plan'))
    await putDraft(draft('deck-saved', { dirty: false }))

    const copies = await oldDraftCopies('deck-plan', 'node-plan', 'Quarterly Plan', {
      isEditor: false,
    })
    expect(copies.map((copy) => copy.slides)).toEqual([SLIDES])
    expect(await oldDraftCopies('deck-saved', 'node-saved', 'Saved', { isEditor: false })).toEqual(
      [],
    )
    expect(await draftIds()).toEqual(['deck-plan'])
  })

  it('dismissing a copy keeps a newer draft another tab wrote since, and lists that one', async () => {
    await putDraft(draft('deck-plan'))
    const [shown] = await listCopies()
    const NEWER = [{ name: 'row-1', elements: [{ type: 'text', content: 'Newer words' }] }]
    await putDraft(draft('deck-plan', { content: NEWER, updatedAt: 1_700_000_005_000 }))

    await discardCopy(shown!)

    expect(await draftIds()).toEqual(['deck-plan'])
    expect((await listCopies()).map((copy) => copy.slides)).toEqual([NEWER])
  })

  // a stamp is the clock's millisecond, so two tabs can write the same one
  it('dismissing a copy keeps a draft another tab wrote at the same moment with other slides', async () => {
    await putDraft(draft('deck-plan'))
    const [shown] = await listCopies()
    const OTHER = [{ name: 'row-1', elements: [{ type: 'text', content: 'Other words' }] }]
    await putDraft(draft('deck-plan', { content: OTHER }))

    await discardCopy(shown!)

    expect(await draftIds()).toEqual(['deck-plan'])
    expect((await listCopies()).map((copy) => copy.slides)).toEqual([OTHER])
  })

  it('dismissing the copy deletes the draft', async () => {
    await putDraft(draft('deck-plan'))
    const [copy] = await listCopies()

    await discardCopy(copy!)

    expect(await draftIds()).toEqual([])
  })
})

describe('a draft the shared store kept for no one', () => {
  const SHARED = [{ name: 'row-1', elements: [{ type: 'text', content: 'Shared words' }] }]
  const OPEN_PLAN = { isEditor: true }

  async function sharedDrafts(change?: (store: IDBObjectStore) => IDBRequest) {
    const db = await openDraftsDb(DRAFTS_DB_NAME)
    const store = db.transaction('presentations', 'readwrite').objectStore('presentations')
    if (change) await requestResult(change(store))
    const ids = await requestResult(store.getAllKeys())
    db.close()
    return ids
  }

  function putShared(fields: Record<string, unknown>) {
    return sharedDrafts((store) => store.put(draft('deck-plan', { user: undefined, ...fields })))
  }

  function planCopies(options = OPEN_PLAN) {
    return oldDraftCopies('deck-plan', 'node-plan', 'Quarterly Plan', options)
  }

  async function downloaded(copy: Parameters<typeof downloadCopy>[0]) {
    const saved: File[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => {
      if (file instanceof File) saved.push(file)
      return 'blob:copy'
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadCopy(copy)
    vi.restoreAllMocks()
    return JSON.parse(await saved[0]!.text()).slides
  }

  afterEach(() => sharedDrafts((store) => store.clear()))

  it('an editor sees it beside their own different draft, each with its own date and words', async () => {
    await putShared({ content: SHARED, updatedAt: 100 })
    await putDraft(draft('deck-plan', { updatedAt: 200 }))

    const shown = await planCopies()
    const listed = await listCopies()

    for (const copies of [shown, listed]) {
      expect(copies.map((copy) => [copy.slides, copy.savedAt.getTime()])).toEqual([
        [SLIDES, 200],
        [SHARED, 100],
      ])
      expect(await downloaded(copies[0]!)).toEqual(SLIDES)
      expect(await downloaded(copies[1]!)).toEqual(SHARED)
    }
  })

  it.each([
    ['the shared', SHARED, SLIDES],
    ['their own', SLIDES, SHARED],
  ])('dismissing %s draft leaves the other', async (_, dismissed, left) => {
    await putShared({ content: SHARED, updatedAt: 100 })
    await putDraft(draft('deck-plan', { updatedAt: 200 }))
    const copies = await planCopies()

    await discardCopy(
      copies.find((copy) => JSON.stringify(copy.slides) === JSON.stringify(dismissed))!,
    )

    expect((await planCopies()).map((copy) => copy.slides)).toEqual([left])
    expect((await listCopies()).map((copy) => copy.slides)).toEqual([left])
  })

  it.each([
    ['no draft of their own', null],
    ['a clean draft of their own', draft('deck-plan', { dirty: false, updatedAt: 200 })],
  ])('with %s, an old tab rewriting their draft loses none of it', async (_, own) => {
    await putShared({ content: SHARED, updatedAt: 100 })
    if (own) await putDraft(own)

    expect((await planCopies()).map((copy) => copy.slides)).toEqual([SHARED])
    await putDraft(draft('deck-plan', { updatedAt: 300 }))

    expect((await listCopies()).map((copy) => copy.slides)).toEqual([SLIDES, SHARED])
    expect(await sharedDrafts()).toEqual(['deck-plan'])
  })

  it("lists and downloads a big one when this page's storage is full", async () => {
    const big = [{ name: 'row-1', elements: [{ type: 'text', content: 'x'.repeat(6_000_000) }] }]
    await putShared({ content: big, updatedAt: 100 })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    const [shown] = await planCopies()
    const [listed] = await listCopies()
    vi.restoreAllMocks()

    expect(await downloaded(shown!)).toEqual(big)
    expect(await downloaded(listed!)).toEqual(big)
  })

  it('is not shown to a viewer, and stays', async () => {
    query.mockResolvedValue([{ ...PLAN, can_edit: false }])
    await putShared({ content: SHARED, updatedAt: 100 })

    expect(await planCopies({ isEditor: false })).toEqual([])
    expect(await listCopies()).toEqual([])
    expect(await sharedDrafts()).toEqual(['deck-plan'])
  })

  it('is not shown on the recovery page when the presentation has no name for the person', async () => {
    query.mockResolvedValue([])
    await putShared({ content: SHARED, updatedAt: 100 })

    expect(await listCopies()).toEqual([])
  })

  it('dismissing it keeps the shared draft another tab rewrote since', async () => {
    await putShared({ content: SHARED, updatedAt: 100 })
    const [shown] = await planCopies()
    const REWRITTEN = [{ name: 'row-1', elements: [{ type: 'text', content: 'Rewritten' }] }]
    await putShared({ content: REWRITTEN, updatedAt: 100 })

    await discardCopy(shown!)

    expect(await sharedDrafts()).toEqual(['deck-plan'])
    expect((await planCopies()).map((copy) => copy.slides)).toEqual([REWRITTEN])
  })

  it('is not counted on Drive', async () => {
    await putShared({ content: SHARED, updatedAt: 100 })

    expect(await copyEntries()).toEqual([])
  })
})

describe("the live room's and the page's copies", () => {
  it('lists what the live room kept, with its slides and the title it kept', async () => {
    await keepInRoomStore('node-room', 'Room Deck')

    const [copy] = await listCopies()

    expect([copy!.node, copy!.title]).toEqual(['node-room', 'Room Deck'])
    expect(copy!.slides).toMatchObject([
      { clientId: 'one', elements: [{ id: 'title', type: 'text' }] },
    ])
  })

  it("lists a page copy under its presentation's title", async () => {
    query.mockResolvedValue([{ ...PLAN, presentation: 'deck-plan' }])
    keepRecovery('node-plan', SLIDES, { sticky: true })

    const [copy] = await listCopies()

    expect([copy!.node, copy!.title, copy!.slides]).toEqual(['node-plan', 'Quarterly Plan', SLIDES])
    expect(query.mock.calls[0]![1].nodes).toEqual(['node-plan'])
  })

  it('discards each kind, and only the one asked', async () => {
    await putDraft(draft('deck-plan'))
    await keepInRoomStore('node-room', 'Room Deck')
    keepRecovery('node-plan', SLIDES, { sticky: true, now: new Date('2026-01-01T00:00:00Z') })
    keepRecovery('node-plan', [{ name: 'other' }], {
      sticky: true,
      now: new Date('2026-01-02T00:00:00Z'),
    })
    const copies = await listCopies()
    expect(copies).toHaveLength(4)

    for (const copy of copies.slice(0, 3)) await discardCopy(copy)

    const left = await listCopies()
    expect(left.map((copy) => copy.key)).toEqual([copies[3]!.key])
  })
})

describe('two page copies with the same date', () => {
  const OTHER = [{ name: 'row-1', elements: [{ type: 'text', content: 'Other words' }] }]
  const now = new Date('2026-01-01T00:00:00Z')

  it('each lists apart, and dismissing one keeps the other', async () => {
    query.mockResolvedValue([{ ...PLAN, node: 'node-plan' }])
    keepRecovery('node-plan', SLIDES, { sticky: true, now })
    keepRecovery('node-plan', OTHER, { sticky: true, now })
    const copies = await listCopies()
    expect(new Set(copies.map((copy) => copy.key)).size).toBe(2)

    await discardCopy(
      copies.find((copy) => JSON.stringify(copy.slides) === JSON.stringify(SLIDES))!,
    )

    expect((await listCopies()).map((copy) => copy.slides)).toEqual([OTHER])
  })
})

describe('naming a few copies', () => {
  it('names a draft and a page copy in one read', async () => {
    await putDraft(draft('deck-plan'))
    keepRecovery('node-page', SLIDES, { sticky: true })

    await listCopies()

    expect(query).toHaveBeenCalledTimes(1)
  })
})

describe('naming many copies', () => {
  const ids = Array.from({ length: 250 }, (_, index) => `deck-${index}`)
  const named = (presentations: string[]) =>
    presentations.map((presentation) => ({
      presentation,
      node: `node-${presentation}`,
      title: `Title ${presentation}`,
    }))

  beforeEach(async () => {
    for (const id of ids) await putDraft(draft(id))
  })

  // the server refuses a read of more than 200 names
  it('names every copy past 200, a read of at most 200 at a time', async () => {
    query.mockImplementation(async (_route, { presentations, nodes }) => {
      if (presentations.length + nodes.length > 200) throw new Error('Too many presentations')
      return named(presentations)
    })

    const copies = await listCopies()

    expect(copies).toHaveLength(250)
    expect(copies.filter((copy) => !copy.title)).toEqual([])
  })

  it('names the page copies past 200 too, in the same reads as the drafts', async () => {
    keepRecovery('node-page', SLIDES, { sticky: true })
    query.mockImplementation(async (_route, { presentations, nodes }) => {
      if (presentations.length + nodes.length > 200) throw new Error('Too many presentations')
      const pages = nodes.map((node: string) => ({
        presentation: 'deck-page',
        node,
        title: 'Page',
      }))
      return [...named(presentations), ...pages]
    })

    const copies = await listCopies()

    expect(copies).toHaveLength(251)
    expect(copies.filter((copy) => !copy.title)).toEqual([])
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('keeps the names one read gave when another read fails', async () => {
    query.mockImplementation(async (_route, { presentations }) => {
      if (presentations.includes('deck-249')) throw new Error('offline')
      return named(presentations)
    })

    const copies = await listCopies()

    const reads: string[][] = query.mock.calls.map((call) => call[1].presentations)
    const [failed, answered] = [
      reads.filter((read) => read.includes('deck-249')),
      reads.filter((read) => !read.includes('deck-249')),
    ]
    const titleOf = (id: string) => copies.find((copy) => copy.key === `draft:${id}`)!.title
    expect(answered.flat().length).toBeGreaterThan(0)
    expect(answered.flat().map(titleOf)).toEqual(answered.flat().map((id) => `Title ${id}`))
    expect(failed.flat().map(titleOf).filter(Boolean)).toEqual([])
  })
})

describe('the copies Drive counts', () => {
  it('names a presentation for every copy, with no server read', async () => {
    await putDraft(draft('deck-plan'))
    await putDraft(draft('deck-saved', { dirty: false }))
    await keepInRoomStore('node-room', 'Room Deck')
    keepRecovery('node-page', SLIDES, { sticky: true })

    const entries = await copyEntries()

    expect(entries.map((entry) => entry.document).sort()).toEqual([
      'deck-plan',
      'node-page',
      'node-room',
    ])
    expect(query).not.toHaveBeenCalled()
  })
})

describe('downloading a copy', () => {
  it('saves its slides as JSON named after the presentation, and keeps the copy', async () => {
    await putDraft(draft('deck-plan'))
    const [copy] = await listCopies()
    const saved: File[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => {
      if (file instanceof File) saved.push(file)
      return 'blob:copy'
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadCopy(copy!)

    expect(saved[0]!.name).toBe('Quarterly Plan (recovered).json')
    expect(JSON.parse(await saved[0]!.text()).slides).toEqual(SLIDES)
    expect(await draftIds()).toEqual(['deck-plan'])
  })

  it("saves the words of what the live room kept, in the element's text", async () => {
    await keepInRoomStore('node-room', 'Room Deck', 'ONLY UNSENT WORDS')
    const [copy] = await listCopies()
    const saved: File[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => {
      if (file instanceof File) saved.push(file)
      return 'blob:copy'
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadCopy(copy!)

    const [slide] = JSON.parse(await saved[0]!.text()).slides
    expect(slide.elements).toHaveLength(1)
    expect(slide.elements[0].content).toContain('ONLY UNSENT WORDS')
  })
})
