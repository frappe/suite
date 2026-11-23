import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('frappe-ui', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }))
vi.mock('@/apps/slides/router', () => ({ router: { currentRoute: { value: { query: {} } } } }))
vi.mock('@/apps/slides/stores/slide', () => ({}))
vi.mock('@/apps/slides/stores/historyMeta', () => ({}))
vi.mock('@/apps/slides/stores/element', () => ({}))

const { transformElements } = await import('./presentation')
const { warmBundledFonts } = await import('@/apps/slides/utils/bundledFonts')

function centredText(id: string) {
  return {
    id,
    type: 'text',
    content: '<p>Centred</p>',
    transform: 'translate(-50%, -50%)',
    left: 100,
    top: 100,
    width: 200,
  }
}

const neverSettles = new Promise<never>(() => {})

describe('measuring centred text', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'fonts')
  })

  it('is not held up by warming bundled fonts that stall', async () => {
    // a face loading through document.fonts keeps ready pending, as a browser does
    let ready: Promise<unknown> = Promise.resolve()
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        get ready() {
          return ready
        },
        load: () => {
          ready = neverSettles
          return neverSettles
        },
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => neverSettles),
    )
    let measured: { transform: string }[] | undefined

    void warmBundledFonts()
    void transformElements([centredText('a')]).then((elements) => {
      measured = elements
    })

    await vi.waitFor(() => expect(measured?.[0].transform).toBe('none'))
  })

  it('waits for a font the text uses, however long it takes', async () => {
    let finishLoading = (_value: unknown) => {}
    const ready = new Promise((resolve) => {
      finishLoading = resolve
    })
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } })
    vi.useFakeTimers()
    let measured: { transform: string }[] | undefined

    void transformElements([centredText('a')]).then((elements) => {
      measured = elements
    })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(measured).toBeUndefined()

    finishLoading(undefined)
    await vi.advanceTimersByTimeAsync(0)

    expect(measured?.[0].transform).toBe('none')
  })
})
