import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('frappe-ui', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }))
vi.mock('@/apps/slides/router', () => ({ router: { currentRoute: { value: { query: {} } } } }))
vi.mock('@/apps/slides/stores/slide', () => ({}))
vi.mock('@/apps/slides/stores/historyMeta', () => ({}))
vi.mock('@/apps/slides/stores/element', () => ({}))
vi.mock('@/apps/slides/stores/saving', () => ({}))

const { transformElements } = await import('./presentation')

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

describe('measuring centred text', () => {
  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'fonts')
  })

  it('carries on after one wait when a font never settles, however many elements it measures', async () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: new Promise(() => {}) },
    })
    vi.useFakeTimers()
    let measured: { transform: string }[] | undefined

    void transformElements(['a', 'b', 'c'].map(centredText)).then((elements) => {
      measured = elements
    })
    await vi.advanceTimersByTimeAsync(2999)

    expect(measured).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1)

    expect(measured?.map(({ transform }) => transform)).toEqual(['none', 'none', 'none'])
  })
})
