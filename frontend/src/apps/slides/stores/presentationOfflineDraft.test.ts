import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { TransportError } from '@/platform/transport'

interface Slide {
  clientId: string
  background: string
  elements: unknown[]
}

interface Draft {
  dirty: boolean
  baseModified: string
  content: Slide[]
}

const slides = ref<Slide[]>([])
const warning = vi.fn()
const server = {
  modified: 'M2',
  background: '#ff0000ff',
  pushes: [] as { base_modified: string }[],
}

function serverRow() {
  return { client_id: 'theirs', background: server.background, elements: '[]' }
}

vi.mock('@/api', async () => {
  const { api: slidesAPI } = await import('@/apps/slides/client/generated')
  return {
    api: { slides: slidesAPI },
    client: {
      query: async () => ({ name: 'p1', modified: server.modified, slides: [serverRow()] }),
      mutation: async (_reference: unknown, input: { base_modified: string }) => {
        server.pushes.push(input)
        if (input.base_modified !== server.modified) {
          throw new TransportError({
            type: 'TimestampMismatchError',
            message: 'changed elsewhere',
            status: 417,
          })
        }

        server.modified = 'M3'
        return { modified: server.modified }
      },
    },
  }
})
vi.mock('frappe-ui', () => ({ toast: { warning: warning, error: vi.fn() } }))
vi.mock('@/apps/slides/utils/helpers', () => ({
  cloneObj: (obj: unknown) => JSON.parse(JSON.stringify(obj)),
}))
vi.mock('@/apps/slides/router', () => ({ router: { currentRoute: { value: { query: {} } } } }))
vi.mock('@/apps/slides/stores/slide', () => ({ slides }))
vi.mock('@/apps/slides/stores/historyMeta', () => ({ commandHistory: {} }))
vi.mock('@/apps/slides/stores/element', () => ({ normalizeZIndices: (els: unknown) => els }))
vi.mock('@/boot/session', () => ({ getSessionUser: () => 'me@example.com' }))

const { initPresentationDoc, presentationDoc, presentationId } = await import('./presentation')
const {
  clearSaveFailure,
  dirty,
  getPresentationFromLocalDB,
  markClean,
  markDirty,
  saveCurrentState,
  saveRefused,
  writeDraft,
} = await import('./saving')

const MINE = '#00ff00ff'

function setNetwork({ isOnline, isReachable }: { isOnline: boolean; isReachable: boolean }) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(isOnline)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (!isReachable) {
        throw new TypeError('Failed to fetch')
      }

      return new Response('{"message":"pong"}')
    }),
  )
}

async function storedDraft() {
  return (await getPresentationFromLocalDB('p1')) as Draft
}

async function reopen() {
  const doc = await initPresentationDoc('p1')
  presentationDoc.value = doc
  return doc
}

function seedDraft(background = MINE) {
  return writeDraft({
    id: 'p1',
    content: [{ clientId: 'mine', background, elements: [] }],
    dirty: true,
    updatedAt: Date.now(),
    baseModified: 'M1',
  })
}

describe('a draft kept against a newer stored document', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    markClean()
    clearSaveFailure()
    server.modified = 'M2'
    server.pushes = []
    presentationId.value = 'p1'
    await seedDraft()
  })

  it('is refused on its old base once back online, leaving the server alone', async () => {
    setNetwork({ isOnline: false, isReachable: false })
    await reopen()
    expect(dirty.value).toBe(true)

    setNetwork({ isOnline: true, isReachable: true })
    await saveCurrentState()

    expect(server.pushes.map((push) => push.base_modified)).toEqual(['M1'])
    expect(server.modified).toBe('M2')
    expect(saveRefused.value).toBe(true)
    const local = await storedDraft()
    expect(local.dirty).toBe(true)
    expect(local.content[0].background).toBe(MINE)
  })

  it('keeps its base through further edits', async () => {
    setNetwork({ isOnline: false, isReachable: false })
    await reopen()

    slides.value[0].background = '#0000ffff'
    markDirty()
    await saveCurrentState()

    const local = await storedDraft()
    expect(local.baseModified).toBe('M1')
    expect(local.content[0].background).toBe('#0000ffff')
    expect(local.dirty).toBe(true)
  })

  it('survives a second offline reload', async () => {
    setNetwork({ isOnline: false, isReachable: false })
    await reopen()
    const doc = await reopen()

    expect(doc.modified).toBe('M1')
    expect(slides.value[0].background).toBe(MINE)
    expect(warning).not.toHaveBeenCalled()
    const local = await storedDraft()
    expect(local.dirty).toBe(true)
  })

  it('survives an in-page reload after a refusal when the network then drops', async () => {
    presentationDoc.value = { name: 'p1', modified: 'M1' }
    slides.value = [{ clientId: 'mine', background: MINE, elements: [] }]
    markDirty()

    setNetwork({ isOnline: true, isReachable: true })
    await saveCurrentState()
    expect(saveRefused.value).toBe(true)

    // this mock answers M2 with the network down, standing in for the worker's stored copy
    setNetwork({ isOnline: true, isReachable: false })
    const doc = await reopen()

    expect(doc.modified).toBe('M1')
    expect(slides.value[0].background).toBe(MINE)
    expect(warning).not.toHaveBeenCalled()
    const local = await storedDraft()
    expect(local.dirty).toBe(true)
  })
})
