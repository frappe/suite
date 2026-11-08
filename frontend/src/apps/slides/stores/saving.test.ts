import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { TransportError } from '@/platform/transport'

const presentationId = ref('p1')
const presentationDoc = ref<any>({ modified: 'M1' })
const inReadonlyMode = ref(false)
const viewOnly = ref(false)
const slides = ref<any[]>([{ clientId: 'c1', background: '#ff0000ff', elements: [] }])

let serverSave: (
  id: string,
  content: any,
  baseModified?: string,
  cancel?: AbortSignal,
) => Promise<string | undefined>

vi.mock('@/apps/slides/stores/presentation', () => ({
  presentationId,
  presentationDoc,
  inReadonlyMode,
  viewOnly,
  savePresentationDoc: (id: string, content: any, baseModified?: string, cancel?: AbortSignal) =>
    serverSave(id, content, baseModified, cancel),
}))

vi.mock('@/apps/slides/stores/slide', () => ({ slides }))

vi.mock('@/apps/slides/utils/helpers', () => ({
  cloneObj: (obj: any) => JSON.parse(JSON.stringify(obj)),
}))

let sessionUser: string | null = 'me@example.com'
vi.mock('@/platform/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/session')>()),
  getCookieSessionUser: () => sessionUser,
}))

const {
  saveCurrentState,
  saveWithoutDelay,
  markDirty,
  dirty,
  saveFailed,
  clearSaveFailure,
  saveRefused,
  getPresentationFromLocalDB,
  stopWrites,
  resumeWrites,
  writeDraft,
} = await import('./saving')

function conflict() {
  return new TransportError({ type: 'TimestampMismatchError', message: 'stale', status: 417 })
}

describe('saveCurrentState', () => {
  // a refused base is held for good, so each test opens on a version of its own
  let base = ''
  let opens = 0

  beforeEach(() => {
    // the draft store schedules its work with timers, so only the clock is faked
    vi.useFakeTimers({ toFake: ['Date'] })
    base = `M${++opens}`
    clearSaveFailure()
    sessionUser = 'me@example.com'
    presentationId.value = 'p1'
    presentationDoc.value = { modified: base }
    slides.value = [{ clientId: 'c1', background: '#ff0000ff', elements: [] }]
    serverSave = async () => {
      presentationDoc.value = { modified: 'M2' }
      return 'M2'
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('persists edits made while the server save is in flight', async () => {
    markDirty()

    serverSave = async () => {
      // the user picks a second color while the first save is still in flight
      slides.value[0].background = '#00ff00ff'
      markDirty()
      presentationDoc.value = { modified: 'M2' }
      return 'M2'
    }

    await saveCurrentState()

    const local: any = await getPresentationFromLocalDB('p1')
    expect(dirty.value).toBe(true)
    expect(local.dirty).toBe(true)
    expect(local.content[0].background).toBe('#00ff00ff')
  })

  it('records the version the server took when the editor moved on mid-save', async () => {
    markDirty()

    serverSave = async () => {
      // resetEditorState() blanks slides, then the editor loads another presentation
      slides.value = []
      presentationId.value = 'p2'
      // presentationDoc belongs to p2 by now, so baseModified has to come
      // from what this save returned
      presentationDoc.value = { modified: 'M9' }
      return 'M2'
    }

    await saveCurrentState()

    const local: any = await getPresentationFromLocalDB('p1')
    // the snapshot the server took, not the blanked slides of the presentation
    // the editor moved on to
    expect(local.content).toHaveLength(1)
    expect(local.dirty).toBe(false)
    expect(local.baseModified).toBe('M2')
  })

  it('marks the local copy clean when nothing changed during the save', async () => {
    markDirty()

    await saveCurrentState()

    const local: any = await getPresentationFromLocalDB('p1')
    expect(dirty.value).toBe(false)
    expect(local.dirty).toBe(false)
    expect(local.baseModified).toBe('M2')
  })

  it('pushes the content and version it snapshotted, not what it can read back later', async () => {
    markDirty()

    let sent: any
    serverSave = async (_id, content, baseModified) => {
      sent = { content, baseModified }
      // a rename lands between the draft write and the push
      presentationDoc.value = { modified: 'M9' }
      return 'M2'
    }

    await saveCurrentState()

    expect(sent.content[0].background).toBe('#ff0000ff')
    expect(sent.baseModified).toBe(base)
  })

  it('keeps a snapshot the server refused as stale', async () => {
    markDirty()

    serverSave = async () => {
      throw conflict()
    }

    await saveCurrentState()

    const local: any = await getPresentationFromLocalDB('p1')
    // the edits are still the only copy of the user's work; discarding them loses it
    expect(local.dirty).toBe(true)
    expect(local.content[0].background).toBe('#ff0000ff')
    expect(dirty.value).toBe(true)
    expect(saveFailed.value).toBe(true)
  })

  it('drafts the edits made during a refused push before holding', async () => {
    markDirty()

    serverSave = async () => {
      slides.value[0].background = '#00ff00ff'
      markDirty()
      throw conflict()
    }

    await saveCurrentState()

    const local: any = await getPresentationFromLocalDB('p1')
    expect(local.content[0].background).toBe('#00ff00ff')
    expect(local.dirty).toBe(true)
  })

  it('stops pushing once the server refuses this tab as stale', async () => {
    markDirty()

    let pushes = 0
    serverSave = async () => {
      pushes++
      throw conflict()
    }

    await saveCurrentState()
    await saveCurrentState()
    expect(pushes).toBe(1)

    // the edits still go to the draft
    slides.value[0].background = '#00ff00ff'
    markDirty()
    await saveCurrentState()
    const local: any = await getPresentationFromLocalDB('p1')
    expect(local.content[0].background).toBe('#00ff00ff')
    expect(local.dirty).toBe(true)
    expect(pushes).toBe(1)

    // a reload gives this tab a newer base, and the hold is on the refused version only
    presentationDoc.value = { modified: 'M-reloaded' }
    serverSave = async () => {
      pushes++
      return 'M-next'
    }
    markDirty()
    await saveCurrentState()
    expect(pushes).toBe(2)
  })

  it('pushes even when the draft store refuses the write', async () => {
    markDirty()

    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    let pushes = 0
    serverSave = async () => {
      pushes++
      presentationDoc.value = { modified: 'M2' }
      return 'M2'
    }

    await saveCurrentState()
    put.mockRestore()

    // the server copy is what makes the edits durable; a broken draft store is not a save failure
    expect(pushes).toBe(1)
    expect(dirty.value).toBe(false)
    expect(saveFailed.value).toBe(false)
  })

  describe('a draft write on a full disk', () => {
    interface Draft {
      baseModified: string
      content: Array<{ background: string }>
    }

    interface FakeTransaction {
      _execRequestAsync(request: { source: IDBObjectStore; operation(): never }): IDBRequest
    }

    const put = IDBObjectStore.prototype.put
    let deleted: string[]
    let pushes: number

    function readDraft(id: string) {
      return getPresentationFromLocalDB(id)
    }

    function quotaError() {
      return new DOMException('full', 'QuotaExceededError')
    }

    // what a failed commit does: the request succeeded, and only the abort event fires
    function abortAfterPut(store: IDBObjectStore, request: IDBRequest, error: DOMException | null) {
      request.addEventListener('success', () => {
        Object.defineProperty(store.transaction, 'error', { get: () => error, set() {} })
        store.transaction.abort()
      })
    }

    function failFirstWrites(count: number, error: DOMException | null) {
      let failures = 0
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        record: unknown,
        key?: IDBValidKey,
      ) {
        const request = put.call(this, record, key)
        if (failures++ < count) {
          abortAfterPut(this, request, error)
        }

        return request
      })
    }

    // what a failed request does: its error event bubbles through the transaction, then the abort
    function failFirstPutRequest(error: DOMException) {
      let failures = 0
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        record: unknown,
        key?: IDBValidKey,
      ) {
        if (failures++ > 0) {
          return put.call(this, record, key)
        }

        const transaction = fromPartial<FakeTransaction>(this.transaction)
        return transaction._execRequestAsync({
          source: this,
          operation() {
            throw error
          },
        })
      })
    }

    beforeEach(() => {
      deleted = []
      pushes = 0
      vi.stubGlobal('caches', {
        delete: async (name: string) => {
          deleted.push(name)
          return true
        },
      })
      serverSave = async () => {
        pushes++
        return 'M2'
      }
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })

    it('still pushes when the commit aborts with no error event', async () => {
      failFirstWrites(Number.POSITIVE_INFINITY, null)
      markDirty()

      const saving = saveCurrentState()

      await vi.waitFor(() => expect(pushes).toBe(1))
      await saving
    })

    it('leaves the next presentation refused when a delayed push lands', async () => {
      let freeSpace!: () => void

      const clearing = new Promise<void>((resolve) => {
        freeSpace = resolve
      })
      vi.stubGlobal('caches', {
        delete: async (name: string) => {
          deleted.push(name)
          await clearing
          return true
        },
      })
      failFirstWrites(1, new DOMException('full', 'QuotaExceededError'))
      markDirty()

      const leaving = saveCurrentState()
      await vi.waitFor(() => expect(deleted.length).toBeGreaterThan(0))

      slides.value = [{ clientId: 'c2', background: '#00ff00ff', elements: [] }]
      presentationId.value = 'p2'
      presentationDoc.value = { modified: 'M9' }
      markDirty()
      serverSave = async () => {
        throw conflict()
      }

      vi.spyOn(console, 'error').mockImplementation(() => {})
      await saveCurrentState()
      expect(saveRefused.value).toBe(true)

      const pushed: string[] = []
      serverSave = async (id) => {
        pushed.push(id)
        return 'M2'
      }

      freeSpace()
      await leaving

      expect(pushed).toEqual(['p1'])
      expect(saveRefused.value).toBe(true)
      expect(saveFailed.value).toBe(true)
    })

    it.each(['QuotaExceededError', 'InvalidAccessError', 'DataError', 'UnknownError'])(
      'clears the visited copies and lands a draft refused with %s',
      async (name) => {
        failFirstWrites(1, new DOMException('full', name))
        slides.value[0].background = '#123456ff'
        markDirty()

        await saveCurrentState()

        expect(deleted).toEqual(['slides-visited'])
        const local = await getPresentationFromLocalDB('p1')
        if (
          !local ||
          typeof local !== 'object' ||
          !('content' in local) ||
          !Array.isArray(local.content)
        )
          throw new Error('Expected a stored presentation')
        expect(local.content[0].background).toBe('#123456ff')
      },
    )

    it('clears the visited copies and lands the draft on the retry', async () => {
      failFirstWrites(1, quotaError())
      let draftAtPush: { content: { background: string }[] } | null = null
      serverSave = async () => {
        draftAtPush = await getPresentationFromLocalDB('p1')
        return 'M2'
      }

      slides.value[0].background = '#123456ff'
      markDirty()

      const saving = saveCurrentState()

      await vi.waitFor(() => expect(draftAtPush?.content[0].background).toBe('#123456ff'))
      expect(deleted).toEqual(['slides-visited'])
      await saving
    })

    it('clears the visited copies and retries when the put request itself fails', async () => {
      failFirstPutRequest(quotaError())
      let draftAtPush: { content: { background: string }[] } | null = null
      let writesAtPush = 0
      serverSave = async () => {
        draftAtPush = await getPresentationFromLocalDB('p1')
        writesAtPush = vi.mocked(IDBObjectStore.prototype.put).mock.calls.length
        return 'M2'
      }

      slides.value[0].background = '#654321ff'
      markDirty()
      await saveCurrentState()

      expect(deleted).toEqual(['slides-visited'])
      expect(writesAtPush).toBe(2)
      expect(draftAtPush?.content[0].background).toBe('#654321ff')
    })

    it('retries once, then pushes without the draft', async () => {
      failFirstWrites(Number.POSITIVE_INFINITY, quotaError())
      let writesAtPush = 0
      let clearsAtPush: string[] = []
      serverSave = async () => {
        writesAtPush = vi.mocked(IDBObjectStore.prototype.put).mock.calls.length
        clearsAtPush = [...deleted]
        pushes++
        return 'M2'
      }

      markDirty()

      const saving = saveCurrentState()

      await vi.waitFor(() => expect(pushes).toBe(1))
      expect(writesAtPush).toBe(2)
      expect(clearsAtPush).toEqual(['slides-visited'])
      await saving
    })

    function holdClear() {
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      vi.stubGlobal('caches', {
        delete: async (name: string) => {
          deleted.push(name)
          await held
          return true
        },
      })
      return release
    }

    function seedDraft(id: string, background = '#aaaaaaff') {
      return writeDraft({
        id,
        content: [{ clientId: 'c1', background, elements: [] }],
        dirty: true,
        updatedAt: 1,
        baseModified: 'M0',
      })
    }

    it('never sends an older tick after a newer one, when the editor moved on', async () => {
      failFirstWrites(1, quotaError())
      const releaseClear = holdClear()
      const sent: string[] = []
      let land!: (modified: string) => void
      serverSave = (_id, content) => {
        sent.push(content[0].background)
        if (sent.length > 1) {
          return Promise.resolve('M3')
        }

        return new Promise((resolve) => {
          land = resolve
        })
      }

      slides.value[0].background = '#aaaaaaff'
      markDirty()
      const older = saveCurrentState()
      await vi.waitFor(() => expect(deleted).toHaveLength(1))

      slides.value[0].background = '#bbbbbbff'
      markDirty()
      const newer = saveCurrentState()
      await vi.waitFor(() => expect(sent).toEqual(['#bbbbbbff']))

      slides.value = []
      presentationId.value = 'p2'
      presentationDoc.value = { modified: 'M9' }
      releaseClear()
      await older
      land('M2')
      await newer

      expect(sent).toEqual(['#bbbbbbff'])
      const local = await readDraft('p1')
      expect(local.content[0].background).toBe('#bbbbbbff')
      expect(local.baseModified).toBe('M2')
    })

    it('never sends an older tick on the old base after the newer one landed', async () => {
      failFirstWrites(1, quotaError())
      const releaseClear = holdClear()
      const sent: string[] = []
      serverSave = async (_id, content) => {
        sent.push(content[0].background)
        return 'M2'
      }

      slides.value[0].background = '#aaaaaaff'
      markDirty()
      const older = saveCurrentState()
      await vi.waitFor(() => expect(deleted).toHaveLength(1))

      slides.value[0].background = '#bbbbbbff'
      markDirty()
      await saveCurrentState()
      releaseClear()
      await older

      expect(sent).toEqual(['#bbbbbbff'])
      expect(saveFailed.value).toBe(false)
      const local = await readDraft('p1')
      expect(local.content[0].background).toBe('#bbbbbbff')
    })

    it('pushes from the first overlapping tick to finish, with every write failing', async () => {
      failFirstWrites(Number.POSITIVE_INFINITY, quotaError())
      const clears: (() => void)[] = []
      vi.stubGlobal('caches', {
        delete: (name: string) => {
          deleted.push(name)
          if (clears.length === 2) {
            return Promise.resolve(true)
          }

          return new Promise((resolve) => {
            clears.push(() => resolve(true))
          })
        },
      })

      markDirty()
      const first = saveCurrentState()
      await vi.waitFor(() => expect(deleted).toHaveLength(1))
      markDirty()
      const second = saveCurrentState()
      await vi.waitFor(() => expect(deleted).toHaveLength(2))

      clears[0]()
      await first
      expect(pushes).toBe(1)

      clears[1]()
      await second
    })

    it('lets a newer dirty retry land over the clean write of the push before it', async () => {
      const sent: string[] = []
      let land!: (modified: string) => void
      serverSave = (_id, content) => {
        sent.push(content[0].background)
        if (sent.length > 1) {
          return Promise.reject(conflict())
        }

        return new Promise((resolve) => {
          land = resolve
        })
      }

      slides.value[0].background = '#aaaaaaff'
      markDirty()
      const pushing = saveCurrentState()
      await vi.waitFor(() => expect(sent).toEqual(['#aaaaaaff']))

      failFirstWrites(1, quotaError())
      const releaseClear = holdClear()
      slides.value[0].background = '#bbbbbbff'
      markDirty()
      const retrying = saveCurrentState()
      await vi.waitFor(() => expect(deleted).toHaveLength(1))

      slides.value = []
      presentationId.value = 'p2'
      presentationDoc.value = { modified: 'M9' }
      land('M2')
      await pushing

      releaseClear()
      await retrying

      const local = await readDraft('p1')
      expect(local).toMatchObject({ dirty: true })
      expect(local.content[0].background).toBe('#bbbbbbff')
    })

    it('writes and sends nothing when the writes stop during the clear', async () => {
      presentationId.value = 'p-stopped-in-clear'
      failFirstWrites(1, quotaError())
      const releaseClear = holdClear()

      markDirty()
      const saving = saveCurrentState()
      await vi.waitFor(() => expect(deleted).toHaveLength(1))
      await stopWrites('p-stopped-in-clear')
      releaseClear()
      await saving

      expect(pushes).toBe(0)
      expect(await getPresentationFromLocalDB('p-stopped-in-clear')).toBeFalsy()
    })

    it('still retries the draft when the clear itself fails', async () => {
      failFirstWrites(1, quotaError())
      vi.stubGlobal('caches', {
        delete: async () => {
          throw new Error('caches gone')
        },
      })
      let draftAtPush!: Draft
      serverSave = async () => {
        draftAtPush = await getPresentationFromLocalDB('p1')
        return 'M2'
      }

      slides.value[0].background = '#123456ff'
      markDirty()

      await saveCurrentState()

      expect(draftAtPush.content[0].background).toBe('#123456ff')
    })

    it('drops the older draft when the clean write after a landed save fails', async () => {
      presentationId.value = 'p-landed-full'
      await seedDraft('p-landed-full')
      failFirstWrites(Number.POSITIVE_INFINITY, quotaError())
      markDirty()

      await saveCurrentState()

      expect(pushes).toBe(1)
      expect(await getPresentationFromLocalDB('p-landed-full')).toBeFalsy()
    })

    it('drops it too when the editor moved on before the save landed', async () => {
      presentationId.value = 'p-landed-moved'
      await seedDraft('p-landed-moved')
      failFirstWrites(Number.POSITIVE_INFINITY, quotaError())
      serverSave = async () => {
        slides.value = []
        presentationId.value = 'p2'
        presentationDoc.value = { modified: 'M9' }
        return 'M2'
      }

      markDirty()

      await saveCurrentState()

      expect(await getPresentationFromLocalDB('p-landed-moved')).toBeFalsy()
    })

    it('keeps the draft when an edit arrived during the landed save', async () => {
      presentationId.value = 'p-landed-edited'
      await seedDraft('p-landed-edited')
      failFirstWrites(Number.POSITIVE_INFINITY, quotaError())
      serverSave = async () => {
        slides.value[0].background = '#00ff00ff'
        markDirty()
        return 'M2'
      }

      markDirty()

      await saveCurrentState()

      const local = await readDraft('p-landed-edited')
      expect(local).toMatchObject({ dirty: true })
      expect(dirty.value).toBe(true)
    })

    it('keeps the draft when an edit arrived before the editor moved on', async () => {
      presentationId.value = 'p-edited-moved'
      await seedDraft('p-edited-moved')
      failFirstWrites(Number.POSITIVE_INFINITY, quotaError())
      serverSave = async () => {
        markDirty()
        slides.value = []
        presentationId.value = 'p2'
        presentationDoc.value = { modified: 'M9' }
        return 'M2'
      }

      markDirty()

      await saveCurrentState()

      const local = await readDraft('p-edited-moved')
      expect(local).toMatchObject({ dirty: true })
    })

    it('keeps the draft when the writes stop during the clean write', async () => {
      presentationId.value = 'p-stopped-clean'
      await seedDraft('p-stopped-clean')
      failFirstWrites(Number.POSITIVE_INFINITY, quotaError())
      let releaseClear!: () => void
      vi.stubGlobal('caches', {
        delete: (name: string) => {
          deleted.push(name)
          if (deleted.length === 1) {
            return Promise.resolve(true)
          }

          return new Promise((resolve) => {
            releaseClear = () => resolve(true)
          })
        },
      })
      markDirty()

      const saving = saveCurrentState()
      await vi.waitFor(() => expect(releaseClear).toBeDefined())
      await stopWrites('p-stopped-clean', () => false)
      releaseClear()
      await saving
      resumeWrites('p-stopped-clean')

      const local = await readDraft('p-stopped-clean')
      expect(local).toMatchObject({ dirty: true })
    })

    it('leaves no retired draft to replay when access returns on a full store', async () => {
      await seedDraft('p-retired-full')
      failFirstWrites(Number.POSITIVE_INFINITY, quotaError())

      await stopWrites('p-retired-full')
      resumeWrites('p-retired-full')

      expect(await getPresentationFromLocalDB('p-retired-full')).toBeFalsy()
    })

    it('leaves the draft when it can be neither rewritten nor removed', async () => {
      await seedDraft('p-stuck')
      failFirstWrites(Number.POSITIVE_INFINITY, quotaError())
      const remove = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(() => {
        throw new DOMException('broken', 'UnknownError')
      })

      await stopWrites('p-stuck')
      resumeWrites('p-stuck')
      expect(remove).toHaveBeenCalled()

      const local = await readDraft('p-stuck')
      expect(local).toMatchObject({ dirty: true })
    })

    it('leaves the draft when what keeps its content cannot', async () => {
      await seedDraft('p-unkept-full')
      failFirstWrites(Number.POSITIVE_INFINITY, quotaError())

      await stopWrites('p-unkept-full', () => false)
      resumeWrites('p-unkept-full')

      const local = await readDraft('p-unkept-full')
      expect(local).toMatchObject({ dirty: true })
    })

    it.each(['AbortError', 'NetworkError', 'InvalidStateError'])(
      'leaves the visited copies alone on %s',
      async (name) => {
        failFirstWrites(Number.POSITIVE_INFINITY, new DOMException('broken', name))
        markDirty()

        const saving = saveCurrentState()

        await vi.waitFor(() => expect(pushes).toBe(1))
        await saving
        expect(deleted).toEqual([])
      },
    )
  })

  it('keeps writing the draft while a push is stuck', async () => {
    markDirty()

    let release!: (modified: string) => void
    serverSave = () => new Promise((resolve) => (release = resolve))
    const stuck = saveCurrentState()
    await vi.waitFor(() => expect(release).toBeDefined())

    slides.value[0].background = '#00ff00ff'
    markDirty()
    await saveCurrentState()

    // the second edit never got a push, but a crash now must still find it
    const local: any = await getPresentationFromLocalDB('p1')
    expect(local.content[0].background).toBe('#00ff00ff')
    expect(local.dirty).toBe(true)

    release('M2')
    await stuck
  })

  it('pushes what the editor typed mid-push once it moved on', async () => {
    markDirty()

    const sent: any[] = []
    serverSave = async (id, content, baseModified) => {
      sent.push({ id, content, baseModified })
      if (sent.length > 1) return 'M3'
      // typed mid-push, turned away by the gate, then the editor leaves
      slides.value[0].background = '#00ff00ff'
      markDirty()
      await saveCurrentState()
      slides.value = []
      presentationId.value = 'p2'
      presentationDoc.value = { modified: 'M9' }
      return 'M2'
    }

    await saveCurrentState()

    expect(sent).toHaveLength(2)
    expect(sent[1].id).toBe('p1')
    expect(sent[1].content[0].background).toBe('#00ff00ff')
    expect(sent[1].baseModified).toBe('M2')
    const local: any = await getPresentationFromLocalDB('p1')
    expect(local.content[0].background).toBe('#00ff00ff')
    expect(local.dirty).toBe(false)
    expect(local.baseModified).toBe('M3')
  })

  it('drops a queued edit once the push it waited on fails', async () => {
    markDirty()

    let fail!: (err: Error) => void
    serverSave = () => new Promise((_, reject) => (fail = reject))
    const stuck = saveCurrentState()
    await vi.waitFor(() => expect(fail).toBeDefined())

    slides.value[0].background = '#222222ff'
    markDirty()
    await saveCurrentState()

    fail(new Error('network'))
    await stuck
    vi.advanceTimersByTime(500)

    // its push lands after the editor moved on
    slides.value[0].background = '#333333ff'
    markDirty()
    const sent: string[] = []
    serverSave = async (_id, content) => {
      sent.push(content[0].background)
      slides.value = []
      presentationId.value = 'p2'
      presentationDoc.value = { modified: 'M9' }
      return 'M2'
    }
    await saveCurrentState()

    // sent as a tail, the older queued edit would overwrite this one
    expect(sent).toEqual(['#333333ff'])
    const local: any = await getPresentationFromLocalDB('p1')
    expect(local.content[0].background).toBe('#333333ff')
    expect(local.dirty).toBe(false)
  })

  it("leaves nothing queued by a tick during the refused push's draft write", async () => {
    markDirty()

    let refuse!: (err: Error) => void

    serverSave = () =>
      new Promise((_, reject) => {
        refuse = reject
      })
    const stuck = saveCurrentState()
    await vi.waitFor(() => expect(refuse).toBeDefined())

    slides.value[0].background = '#222222ff'
    markDirty()
    refuse(conflict())
    const tick = saveCurrentState()
    await Promise.all([stuck, tick])

    // the reload clears the hold, and the next push lands after the editor moved on
    clearSaveFailure()
    slides.value[0].background = '#333333ff'
    markDirty()
    const sent: string[] = []
    serverSave = async (_id, content) => {
      sent.push(content[0].background)
      slides.value = []
      presentationId.value = 'p2'
      presentationDoc.value = { modified: 'M9' }
      return 'M2'
    }

    await saveCurrentState()

    // sent as a tail, the queued edit would overwrite this one
    expect(sent).toEqual(['#333333ff'])
  })

  it('keeps the tail on the new base when its own push dies', async () => {
    markDirty()

    let pushes = 0
    serverSave = async () => {
      if (++pushes > 1) throw new Error('network')
      slides.value[0].background = '#00ff00ff'
      markDirty()
      await saveCurrentState()
      slides.value = []
      presentationId.value = 'p2'
      presentationDoc.value = { modified: 'M9' }
      return 'M2'
    }

    await saveCurrentState()

    // on an older base the next load would throw the tail away as stale
    const local: any = await getPresentationFromLocalDB('p1')
    expect(local.content[0].background).toBe('#00ff00ff')
    expect(local.dirty).toBe(true)
    expect(local.baseModified).toBe('M2')
    expect(saveFailed.value).toBe(false)
  })

  it('waits longer after each failed push', async () => {
    markDirty()

    let pushes = 0
    serverSave = async () => {
      pushes++
      throw new Error('500')
    }

    await saveCurrentState()
    await saveCurrentState()
    expect(pushes).toBe(1)

    vi.advanceTimersByTime(500)
    await saveCurrentState()
    expect(pushes).toBe(2)

    vi.advanceTimersByTime(500)
    await saveCurrentState()
    expect(pushes).toBe(2)
    vi.advanceTimersByTime(500)
    await saveCurrentState()
    expect(pushes).toBe(3)
  })

  it("does not send an edit that waited behind another presentation's push", async () => {
    markDirty()
    let land!: () => void
    serverSave = () =>
      new Promise((resolve) => {
        land = () => resolve('M2')
      })

    const leaving = saveCurrentState()
    await vi.waitFor(() => expect(land).toBeDefined())

    presentationId.value = 'p2'
    presentationDoc.value = { modified: 'M9' }
    slides.value = [{ clientId: 'c2', background: '#111111ff', elements: [] }]
    markDirty()
    await saveCurrentState()
    land()
    await leaving

    const pushed: string[] = []
    serverSave = async (id, content) => {
      pushed.push(`${id} ${content[0].background}`)
      presentationId.value = 'p3'
      slides.value = []
      return 'M10'
    }

    slides.value = [{ clientId: 'c2', background: '#222222ff', elements: [] }]
    markDirty()
    await saveCurrentState()

    expect(pushed).toEqual(['p2 #222222ff'])
  })

  describe('a push that fails after the editor moved on', () => {
    async function failedAfterMoving() {
      markDirty()

      serverSave = async () => {
        slides.value = []
        presentationId.value = 'p2'
        presentationDoc.value = { modified: 'M9' }
        throw new Error('500')
      }

      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      await saveCurrentState()
      error.mockRestore()
      slides.value = [{ clientId: 'c2', background: '#00ff00ff', elements: [] }]
    }

    it('does not show as failed on the presentation now open', async () => {
      await failedAfterMoving()

      expect(saveFailed.value).toBe(false)
    })

    it('keeps its edits for the next open of its own presentation', async () => {
      await failedAfterMoving()

      expect(await getPresentationFromLocalDB('p1')).toMatchObject({
        dirty: true,
        content: [{ clientId: 'c1' }],
      })
    })

    it('does not hold back the first push of the presentation now open', async () => {
      await failedAfterMoving()

      const pushed: string[] = []
      serverSave = async (id) => {
        pushed.push(id)
        return 'M10'
      }

      markDirty()
      await saveCurrentState()

      expect(pushed).toEqual(['p2'])
    })
  })

  it('pushes on request without waiting out the backoff', async () => {
    markDirty()

    let pushes = 0
    serverSave = async () => {
      pushes++
      throw new Error('500')
    }

    await saveCurrentState()
    await saveCurrentState()
    expect(pushes).toBe(1)

    await saveWithoutDelay()
    expect(pushes).toBe(2)
  })
})

describe('drafts', () => {
  beforeEach(() => {
    sessionUser = 'me@example.com'
    presentationDoc.value = { modified: 'M1' }
    slides.value = [{ clientId: 'c1', background: '#ff0000ff', elements: [] }]
    serverSave = async () => 'M2'
  })

  it('ignores a draft another user of this browser left', async () => {
    presentationId.value = 'p-user'
    sessionUser = 'other@example.com'
    markDirty()
    await saveCurrentState()
    expect(await getPresentationFromLocalDB('p-user')).not.toBeNull()

    sessionUser = 'me@example.com'
    expect(await getPresentationFromLocalDB('p-user')).toBeNull()
  })

  it('offers a draft with no known owner only to someone who can edit', async () => {
    const { openDraftsDb } = await import('@/apps/slides/utils/drafts')
    const legacyDb = await openDraftsDb('slides-db')
    const tx = legacyDb.transaction('presentations', 'readwrite')
    const unowned = {
      id: 'p-shared',
      content: [],
      dirty: true,
    }
    tx.objectStore('presentations').put(unowned)
    await new Promise((resolve) => {
      tx.oncomplete = resolve
    })
    legacyDb.close()

    viewOnly.value = true
    expect(await getPresentationFromLocalDB('p-shared')).toBeNull()

    viewOnly.value = false
    expect(await getPresentationFromLocalDB('p-shared')).toMatchObject({ id: 'p-shared' })
  })
})

describe('losing edit access', () => {
  beforeEach(() => {
    sessionUser = 'me@example.com'
    clearSaveFailure()
    presentationDoc.value = { modified: 'A1' }
    slides.value = [{ clientId: 'c1', background: '#ff0000ff', elements: [] }]
  })

  it('cancels the save under way, starts none after, and leaves no draft to replay', async () => {
    presentationId.value = 'p-narrowed'
    const pushes: Array<{ content: any; cancel?: AbortSignal }> = []
    let answer: (modified: string) => void = () => {}
    serverSave = (_id, content, _base, cancel) => {
      pushes.push({ content, cancel })
      return new Promise((resolve) => (answer = resolve))
    }

    markDirty()
    const underWay = saveCurrentState()
    await vi.waitFor(() => expect(pushes).toHaveLength(1))
    // an edit while the push is out queues a tail for the next push
    slides.value[0].background = '#00ff00ff'
    markDirty()
    await saveCurrentState()

    await stopWrites('p-narrowed')
    expect(pushes[0]!.cancel?.aborted).toBe(true)
    // the server answers anyway: nothing of that save lands
    answer('A2')
    await underWay
    markDirty()
    await saveCurrentState()

    expect(pushes).toHaveLength(1)
    const local: any = await getPresentationFromLocalDB('p-narrowed')
    expect(local.dirty).toBe(false)
  })

  it('saves again once edit access is back', async () => {
    presentationId.value = 'p-regained'
    const pushed: string[] = []
    serverSave = async (id) => {
      pushed.push(id)
      return 'B2'
    }
    await stopWrites('p-regained')
    markDirty()
    await saveCurrentState()
    expect(pushed).toEqual([])

    resumeWrites('p-regained')
    await saveCurrentState()

    expect(pushed).toEqual(['p-regained'])
  })
})
