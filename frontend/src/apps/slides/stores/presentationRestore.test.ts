import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const slides = ref<any[]>([])
let served: any = null
let requests: any[] = []
const docs = new Map<string, any>()
const holds = new Map<string, Promise<void>>()

const servedFor = (name: string) => docs.get(name) ?? served

vi.mock('@/api', async () => {
  const { api: slidesAPI } = await import('@/apps/slides/client/generated')
  const send = async (
    reference: { path: string; method?: string },
    params: Record<string, unknown>,
  ) => {
    const url = reference.path.replace('/api/method/', '')
    requests.push({ url, method: reference.method, params })
    if (!url.endsWith('get_public_presentation')) return {}
    const held = holds.get(String(params.name))
    if (held) await held
    return structuredClone(servedFor(String(params.name)))
  }
  return { api: { slides: slidesAPI }, client: { query: send, mutation: send } }
})
vi.mock('frappe-ui', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }))
vi.mock('@/apps/slides/router', () => ({ router: { currentRoute: { value: { query: {} } } } }))
vi.mock('@/apps/slides/stores/slide', () => ({ slides }))
vi.mock('@/apps/slides/stores/historyMeta', () => ({ commandHistory: { clearHistory: () => {} } }))
vi.mock('@/apps/slides/stores/element', () => ({ normalizeZIndices: (els: any) => els }))

const {
  initPresentationDoc,
  currentOpening,
  resetEditorState,
  presentationId,
  presentationDoc,
  setDocumentContext,
} = await import('./presentation')

const slide = (background: string) => ({ clientId: 'c1', background, elements: [] })

describe('loading a presentation', () => {
  beforeEach(() => {
    setDocumentContext('p1', undefined)
    slides.value = []
    served = null
    requests = []
    docs.clear()
    holds.clear()
  })

  it('fetches over GET with the url and param order the offline copy pins', async () => {
    served = { modified: 'M1', slides: [] }

    await initPresentationDoc('p1')

    const [load] = requests
    expect(load.url).toBe('suite.slides.doctype.presentation.presentation.get_public_presentation')
    expect(load.method).toBe('GET')
    expect(Object.entries(load.params)).toEqual([['name', 'p1']])
  })

  it('exposes advance_after as advanceAfter', async () => {
    served = { modified: 'M1', slides: [{ ...slide('#ff0000ff'), advance_after: '5' }] }

    await initPresentationDoc('p1')

    expect(slides.value[0].advanceAfter).toBe('5')
    expect(slides.value[0]).not.toHaveProperty('advance_after')
  })
})

describe('overlapping loads', () => {
  let releaseSlow: () => void

  beforeEach(() => {
    slides.value = []
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
    expect(fast?.name).toBe('fast')
    expect(presentationId.value).toBe('fast')
    expect(presentationDoc.value.name).toBe('fast')
    expect(slides.value[0].background).toBe('#00ff00ff')
  })

  it('drops a load the editor moved past while it was in flight', async () => {
    const slow = initPresentationDoc('slow')
    // the editor left for a blank one
    resetEditorState()
    releaseSlow()

    expect(await slow).toBe(null)
    expect(slides.value).toHaveLength(0)
  })
})

describe('work that waited on a presentation', () => {
  beforeEach(() => {
    served = { modified: 'M1', slides: [] }
    holds.clear()
  })

  it('lands nowhere once the presentation was left and opened again', async () => {
    await initPresentationDoc('p1')
    const stillOpen = currentOpening()

    await initPresentationDoc('p2')
    await initPresentationDoc('p1')

    expect(stillOpen()).toBe(false)
  })

  it('still lands while the presentation it started in stays open', async () => {
    await initPresentationDoc('p1')
    const stillOpen = currentOpening()

    expect(stillOpen()).toBe(true)
  })
})
