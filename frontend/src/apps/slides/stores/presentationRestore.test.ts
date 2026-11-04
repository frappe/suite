import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const slides = ref<any[]>([])
const markDirty = vi.fn()
const markClean = vi.fn()
const writeDraft = vi.fn()
const warning = vi.fn()
const saveRefused = ref(false)
let local: any = null
let served: any = null
let requests: any[] = []
const docs = new Map<string, any>()
const holds = new Map<string, Promise<void>>()

const servedFor = (name: string) => docs.get(name) ?? served

vi.mock('@/api', async () => {
  const { api: slidesAPI } = await import('@/apps/slides/client/generated')
  const send = async (reference: { path: string }, params: Record<string, unknown>) => {
    const url = reference.path.replace('/api/method/', '')
    requests.push({ url, method: reference.method, params })
    if (!url.endsWith('get_public_presentation')) return {}
    const held = holds.get(String(params.name))
    if (held) await held
    return structuredClone(servedFor(String(params.name)))
  }
  return { api: { slides: slidesAPI }, client: { query: send, mutation: send } }
})
vi.mock('frappe-ui', () => ({ toast: { warning: warning, error: vi.fn() } }))
vi.mock('@/apps/slides/router', () => ({ router: { currentRoute: { value: { query: {} } } } }))
vi.mock('@/apps/slides/stores/slide', () => ({ slides }))
vi.mock('@/apps/slides/stores/historyMeta', () => ({ commandHistory: {} }))
vi.mock('@/apps/slides/stores/element', () => ({ normalizeZIndices: (els: any) => els }))
vi.mock('@/platform/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/session')>()),
  getCookieSessionUser: () => 'me@example.com',
}))
vi.mock('@/apps/slides/stores/saving', () => ({
  markDirty,
  markClean,
  writeDraft,
  clearSaveFailure: () => (saveRefused.value = false),
  saveRefused,
  getPresentationFromLocalDB: async () => {
    if (local instanceof Error) throw local
    return local
  },
}))

const { lockedElsewhere } = await import('./editLock')
const {
  initPresentationDoc,
  startLoad,
  presentationId,
  presentationDoc,
  inReadonlyMode,
  setDocumentContext,
} = await import('./presentation')

const slide = (background: string) => ({ clientId: 'c1', background, elements: [] })

const keepDiscarded = vi.fn()
let releaseContext: (() => void) | undefined

describe('loading a presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    keepDiscarded.mockReset()
    releaseContext = setDocumentContext('p1', undefined, undefined, keepDiscarded)
    lockedElsewhere.value = false
    saveRefused.value = false
    slides.value = []
    local = null
    served = null
    requests = []
    docs.clear()
    holds.clear()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"pong"}')),
    )
  })

  it('fetches over GET with the url and param order the offline copy pins', async () => {
    served = { modified: 'M1', slides: [] }

    await initPresentationDoc('p1')

    const [load] = requests
    expect(load.url).toBe('suite.slides.doctype.presentation.presentation.get_public_presentation')
    expect(load.method).toBe('GET')
    expect(Object.entries(load.params)).toEqual([['name', 'p1']])
  })

  it('prefers the local copy over a served document older than the last save', async () => {
    local = { dirty: false, baseModified: 'M2', content: [slide('#00ff00ff')] }
    served = { modified: 'M1', slides: [slide('#ff0000ff')] }

    const doc = await initPresentationDoc('p1')

    expect(slides.value[0].background).toBe('#00ff00ff')
    expect(doc.modified).toBe('M2')
    expect(markClean).toHaveBeenCalled()
    expect(markDirty).not.toHaveBeenCalled()
  })

  it('restores unsynced edits made on the served version', async () => {
    local = { dirty: true, baseModified: 'M1', content: [slide('#00ff00ff')] }
    served = { modified: 'M1', slides: [slide('#ff0000ff')] }

    await initPresentationDoc('p1')

    expect(slides.value[0].background).toBe('#00ff00ff')
    expect(markDirty).toHaveBeenCalled()
    expect(warning).not.toHaveBeenCalled()
  })

  it('loads the server copy when the draft store cannot be opened', async () => {
    local = new Error('quota exceeded')
    served = { modified: 'M1', slides: [slide('#ff0000ff')] }

    await initPresentationDoc('p1')

    expect(slides.value[0].background).toBe('#ff0000ff')
  })

  it('keeps quiet when the version past the draft is the push it waited on', async () => {
    local = { dirty: true, baseModified: 'M1', content: [slide('#00ff00ff')] }
    served = {
      modified: 'M2',
      modified_by: 'me@example.com',
      slides: [{ client_id: 'c1', background: '#00ff00ff', elements: '[]' }],
    }

    await initPresentationDoc('p1')

    expect(slides.value[0].background).toBe('#00ff00ff')
    expect(warning).not.toHaveBeenCalled()
    expect(markClean).toHaveBeenCalled()
    expect(writeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ dirty: false, baseModified: 'M2' }),
    )
  })

  it('discards unsynced edits once the server has moved past them', async () => {
    local = { dirty: true, baseModified: 'M1', content: [slide('#00ff00ff')] }
    served = { modified: 'M2', slides: [slide('#ff0000ff')] }

    await initPresentationDoc('p1')

    expect(slides.value[0].background).toBe('#ff0000ff')
    expect(warning).toHaveBeenCalled()
    expect(markClean).toHaveBeenCalled()
    expect(writeDraft).toHaveBeenCalledWith(expect.objectContaining({ dirty: false }))
  })

  describe('a draft the server has moved past', () => {
    beforeEach(() => {
      local = { dirty: true, baseModified: 'M1', content: [slide('#00ff00ff')] }
      served = { modified: 'M2', slides: [slide('#ff0000ff')] }
    })

    it('leaves its content as a copy, before the draft goes clean', async () => {
      const order: string[] = []
      keepDiscarded.mockImplementation(() => order.push('copy'))
      writeDraft.mockImplementation(async () => order.push('clean'))

      await initPresentationDoc('p1')

      expect(keepDiscarded).toHaveBeenCalledWith(local.content)
      expect(order).toEqual(['copy', 'clean'])
      expect(warning).toHaveBeenCalledWith(
        'Your changes never reached the server. They are kept on this device.',
      )
    })

    it('stays the draft when the copy cannot be stored', async () => {
      keepDiscarded.mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })

      const doc = await initPresentationDoc('p1')

      expect(doc.modified).toBe('M1')
      expect(slides.value[0].background).toBe('#00ff00ff')
      expect(markDirty).toHaveBeenCalled()
      expect(writeDraft).not.toHaveBeenCalled()
      expect(warning).not.toHaveBeenCalled()
    })

    it('stays the draft when no surface took the copy', async () => {
      releaseContext?.()

      const doc = await initPresentationDoc('p1')

      expect(doc.modified).toBe('M1')
      expect(slides.value[0].background).toBe('#00ff00ff')
      expect(writeDraft).not.toHaveBeenCalled()
    })

    it('makes no copy in a tab another one holds the lock over', async () => {
      lockedElsewhere.value = true

      await initPresentationDoc('p1')

      expect(keepDiscarded).not.toHaveBeenCalled()
    })

    it('makes no copy of a push that landed', async () => {
      served = {
        modified: 'M2',
        modified_by: 'me@example.com',
        slides: [{ client_id: 'c1', background: '#00ff00ff', elements: '[]' }],
      }

      await initPresentationDoc('p1')

      expect(keepDiscarded).not.toHaveBeenCalled()
    })

    it('makes no copy of a draft it restores', async () => {
      local.baseModified = 'M2'

      await initPresentationDoc('p1')

      expect(keepDiscarded).not.toHaveBeenCalled()
    })

    it('with no base, offline, leaves a copy too', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      local = { dirty: true, content: [slide('#00ff00ff')] }

      const doc = await initPresentationDoc('p1')

      expect(keepDiscarded).toHaveBeenCalledWith(local.content)
      expect(doc.modified).toBe('M2')
    })

    it('with no base and no room for a copy, stays on a base the server refuses', async () => {
      local = { dirty: true, content: [slide('#00ff00ff')] }
      keepDiscarded.mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })

      const doc = await initPresentationDoc('p1')

      expect(doc.modified).toBe('')
      expect(slides.value[0].background).toBe('#00ff00ff')
      expect(markDirty).toHaveBeenCalled()
    })
  })

  describe('a draft on the old stamp of a presentation the migration rewrote', () => {
    const oldLink = '/files/a.png'

    beforeEach(() => {
      local = {
        dirty: true,
        baseModified: 'M1',
        content: [
          {
            clientId: 'c1',
            background: oldLink,
            elements: [{ type: 'image', src: oldLink, attachmentName: 'a.png' }],
          },
        ],
      }
      served = {
        modified: 'M2',
        modified_by: 'me@example.com',
        slides: [
          {
            client_id: 'c1',
            background: 'node-1',
            elements: JSON.stringify([{ type: 'image', src: 'node-1' }]),
          },
        ],
      }
    })

    it('online, shows the server rows and keeps the edits as a copy on the device', async () => {
      await initPresentationDoc('p1')

      expect(keepDiscarded).toHaveBeenCalledWith(local.content)
      expect(warning).toHaveBeenCalled()
      expect(writeDraft).toHaveBeenCalledWith(
        expect.objectContaining({ dirty: false, baseModified: 'M1', content: local.content }),
      )
      expect(JSON.stringify(slides.value)).not.toContain(oldLink)
      expect(JSON.stringify(requests)).not.toContain(oldLink)
    })

    it('offline, stays dirty on the old stamp, which the server refuses', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

      const doc = await initPresentationDoc('p1')

      expect(doc.modified).toBe('M1')
      expect(markDirty).toHaveBeenCalled()
      expect(slides.value[0].background).toBe(oldLink)
      expect(writeDraft).not.toHaveBeenCalled()
      expect(JSON.stringify(requests)).not.toContain(oldLink)
    })
  })

  describe('a dirty draft on an older base than the served document', () => {
    function expectDraftKept(doc: { modified: string }) {
      expect(slides.value[0].background).toBe('#00ff00ff')
      expect(doc.modified).toBe('M1')
      expect(markDirty).toHaveBeenCalled()
      expect(warning).not.toHaveBeenCalled()
      expect(writeDraft).not.toHaveBeenCalled()
    }

    beforeEach(() => {
      local = { dirty: true, baseModified: 'M1', content: [slide('#00ff00ff')] }
      served = { modified: 'M2', slides: [slide('#ff0000ff')] }
    })

    it('stays dirty and on its base offline, without asking the network', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

      expectDraftKept(await initPresentationDoc('p1'))
      expect(fetch).not.toHaveBeenCalled()
    })

    it('stays when onLine is true but the server cannot be reached', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

      expectDraftKept(await initPresentationDoc('p1'))
    })

    it('stays when the server answers with an error', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response('', { status: 502 }))

      expectDraftKept(await initPresentationDoc('p1'))
    })

    it('stays when a captive portal redirects the check', async () => {
      const portal = new Response('<html></html>')
      Object.defineProperty(portal, 'redirected', { value: true })
      vi.mocked(fetch).mockResolvedValue(portal)

      expectDraftKept(await initPresentationDoc('p1'))
    })

    it('stays when the check hangs, and the load goes on', async () => {
      vi.mocked(fetch).mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))
          }),
      )

      expectDraftKept(await initPresentationDoc('p1'))
    })

    it.each([
      ['a page that is not JSON', '<html>Sign in</html>'],
      ['a JSON answer that is not the ping', '{"message":"welcome"}'],
    ])('stays when the check gets %s', async (_case, body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(body)),
      )

      const doc = await initPresentationDoc('p1')

      expect(doc.modified).toBe('M1')
      expect(slides.value[0].background).toBe('#00ff00ff')
      expect(writeDraft).not.toHaveBeenCalled()
    })

    it('drops the load, the draft untouched, if another starts during the check', async () => {
      let answer!: (response: Response) => void

      const check = new Promise<Response>((resolve) => {
        answer = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(() => check),
      )

      const superseded = initPresentationDoc('p1')
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
      startLoad()
      answer(new Response('{"message":"pong"}'))

      expect(await superseded).toBe(null)
      expect(writeDraft).not.toHaveBeenCalled()
      expect(keepDiscarded).not.toHaveBeenCalled()
      expect(slides.value).toEqual([])
    })

    it('is discarded with the notice when the server answers', async () => {
      await initPresentationDoc('p1')

      expect(slides.value[0].background).toBe('#ff0000ff')
      expect(warning).toHaveBeenCalled()
      expect(writeDraft).toHaveBeenCalledWith(expect.objectContaining({ dirty: false }))
      expect(fetch).toHaveBeenCalledWith(
        '/api/method/ping',
        expect.objectContaining({ cache: 'no-store' }),
      )
    })

    it('goes clean offline when it already landed in the served document', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      served = {
        modified: 'M2',
        modified_by: 'me@example.com',
        slides: [{ client_id: 'c1', background: '#00ff00ff', elements: '[]' }],
      }

      const doc = await initPresentationDoc('p1')

      expect(doc.modified).toBe('M2')
      expect(warning).not.toHaveBeenCalled()
      expect(writeDraft).toHaveBeenCalledWith(
        expect.objectContaining({ dirty: false, baseModified: 'M2' }),
      )
      expect(fetch).not.toHaveBeenCalled()
    })

    it('is treated as today when it has no base to hold', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      local = { dirty: true, content: [slide('#00ff00ff')] }

      const doc = await initPresentationDoc('p1')

      expect(doc.modified).toBe('M2')
      expect(slides.value[0].background).toBe('#ff0000ff')
      expect(fetch).not.toHaveBeenCalled()
    })

    it('stays untouched by a tab another one holds the lock over, offline', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      lockedElsewhere.value = true

      const doc = await initPresentationDoc('p1')

      expect(doc.modified).toBe('M1')
      expect(slides.value[0].background).toBe('#00ff00ff')
      expect(warning).not.toHaveBeenCalled()
      expect(writeDraft).not.toHaveBeenCalled()
    })

    it('is not read by a read-only load, offline', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

      const doc = await initPresentationDoc('p1', true)

      expect(doc.modified).toBe('M2')
      expect(slides.value[0].background).toBe('#ff0000ff')
      expect(writeDraft).not.toHaveBeenCalled()
    })
  })

  it('shows the served document offline over a clean draft on an older base', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    local = { dirty: false, baseModified: 'M1', content: [slide('#00ff00ff')] }
    served = { modified: 'M2', slides: [slide('#ff0000ff')] }

    const doc = await initPresentationDoc('p1')

    expect(doc.modified).toBe('M2')
    expect(slides.value[0].background).toBe('#ff0000ff')
    expect(markDirty).not.toHaveBeenCalled()
  })

  it('asks the network nothing for a draft on the served version', async () => {
    local = { dirty: true, baseModified: 'M1', content: [slide('#00ff00ff')] }
    served = { modified: 'M1', slides: [slide('#ff0000ff')] }

    await initPresentationDoc('p1')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('exposes advance_after as advanceAfter', async () => {
    served = { modified: 'M1', slides: [{ ...slide('#ff0000ff'), advance_after: '5' }] }

    await initPresentationDoc('p1')

    expect(slides.value[0].advanceAfter).toBe('5')
    expect(slides.value[0]).not.toHaveProperty('advance_after')
  })

  it('stops editing once the server refused this version', async () => {
    saveRefused.value = true
    expect(inReadonlyMode.value).toBe(true)
  })

  it('lets a refused tab reload in place as a writer', async () => {
    saveRefused.value = true
    local = { dirty: true, baseModified: 'M1', content: [slide('#00ff00ff')] }
    served = { modified: 'M2', slides: [slide('#ff0000ff')] }

    await initPresentationDoc('p1')

    expect(inReadonlyMode.value).toBe(false)
    expect(warning).toHaveBeenCalled()
    expect(writeDraft).toHaveBeenCalledWith(expect.objectContaining({ dirty: false }))
  })

  it('holds the refusal until the reload lands', async () => {
    saveRefused.value = true
    served = { modified: 'M2', slides: [slide('#ff0000ff')] }
    let release: () => void = () => {}
    holds.set('p1', new Promise<void>((resolve) => (release = resolve)))

    const reload = initPresentationDoc('p1')
    await new Promise((resolve) => setTimeout(resolve))

    // the stale slides on screen must not turn editable while the fetch is out
    expect(inReadonlyMode.value).toBe(true)

    release()
    await reload
    expect(inReadonlyMode.value).toBe(false)
  })

  it('leaves the draft and the discard notice to the tab that holds the lock', async () => {
    lockedElsewhere.value = true
    local = { dirty: true, baseModified: 'M1', content: [slide('#00ff00ff')] }
    served = { modified: 'M2', slides: [slide('#ff0000ff')] }

    await initPresentationDoc('p1')

    expect(slides.value[0].background).toBe('#ff0000ff')
    expect(warning).not.toHaveBeenCalled()
    expect(writeDraft).not.toHaveBeenCalled()
  })
})

describe('overlapping loads', () => {
  let releaseSlow: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    lockedElsewhere.value = false
    saveRefused.value = false
    slides.value = []
    local = null
    served = null
    requests = []
    docs.clear()
    holds.clear()
    docs.set('slow', { name: 'slow', modified: 'M1', slides: [slide('#ff0000ff')] })
    docs.set('fast', { name: 'fast', modified: 'M1', slides: [slide('#00ff00ff')] })
    holds.set('slow', new Promise<void>((resolve) => (releaseSlow = resolve)))
  })

  it('leaves the editor to the load that started last', async () => {
    const slow = initPresentationDoc('slow')
    const fast = await initPresentationDoc('fast')
    releaseSlow()

    expect(await slow).toBe(null)
    expect(fast.name).toBe('fast')
    expect(presentationId.value).toBe('fast')
    expect(presentationDoc.value.name).toBe('fast')
    expect(slides.value[0].background).toBe('#00ff00ff')
  })

  it('leaves the draft alone once the editor moved past the load', async () => {
    local = { dirty: true, baseModified: 'M0', content: [slide('#00ff00ff')] }
    const slow = initPresentationDoc('slow')
    startLoad()
    releaseSlow()

    // the read-only state it would consult belongs to whatever is open now
    expect(await slow).toBe(null)
    expect(writeDraft).not.toHaveBeenCalled()
    expect(warning).not.toHaveBeenCalled()
  })

  it('drops a load the editor moved past while it was in flight', async () => {
    const slow = initPresentationDoc('slow')
    // the editor short-circuits back to a presentation it already holds
    startLoad()
    releaseSlow()

    expect(await slow).toBe(null)
    expect(slides.value).toHaveLength(0)
    expect(markClean).not.toHaveBeenCalled()
    expect(markDirty).not.toHaveBeenCalled()
  })
})
