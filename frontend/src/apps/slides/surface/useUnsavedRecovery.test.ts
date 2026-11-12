import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { toast } from 'frappe-ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { slides } from '@/apps/slides/stores/slide'

import { downloadSlides, keepRecovery } from './recovery'
import { useUnsavedRecovery } from './useUnsavedRecovery'

vi.mock('frappe-ui', () => ({ toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('@/apps/slides/stores/presentation', () => ({ viewOnly: { value: false } }))
vi.mock('@/apps/slides/stores/slide', async () => {
  const { ref } = await import('vue')
  return { slides: ref([]) }
})
vi.mock('./recovery', async (original) => ({
  ...(await original<typeof import('./recovery')>()),
  downloadRecovery: vi.fn(),
  downloadSlides: vi.fn(),
  keepRecovery: vi.fn(),
  readRecovery: () => [],
}))
const stored = await vi.importActual<typeof import('./recovery')>('./recovery')

function recovery() {
  return useUnsavedRecovery(
    fromPartial<DocumentSession>({ nodeId: 'n', contentDocname: 'd', title: ref('Talk') }),
    {
      isWritable: () => true,
      isReadable: () => true,
      load: async () => {},
      loseAccess: async () => false,
      regainAccess: async () => 'editing',
    },
  )
}

const typed = [{ clientId: 's', elements: [{ id: 'a', content: '<p>the only copy</p>' }] }]

describe('keeping the text of a deleted element', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    slides.value = JSON.parse(JSON.stringify(typed))
  })

  it('stores it and offers nothing more when the device has room', () => {
    expect(recovery().retainStickyOrOffer()).toBe(true)

    expect(keepRecovery).toHaveBeenCalledWith('n', typed, { sticky: true })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('still downloads the text after the element is gone when the device has no room', () => {
    vi.mocked(keepRecovery).mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(recovery().retainStickyOrOffer()).toBe(false)
    slides.value = [{ clientId: 's', elements: [] }]
    const options = fromAny<{ action: { onClick: () => void }; duration: number }, unknown>(
      vi.mocked(toast.error).mock.calls[0][1],
    )
    options.action.onClick()

    expect(options.duration).toBe(Number.POSITIVE_INFINITY)
    expect(downloadSlides).toHaveBeenCalledWith(typed, 'Talk')
  })
})

describe("the menu's Discard", () => {
  const shownAt = new Date('2026-11-12T10:00:00Z')

  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it.each([
    ['a newer', new Date('2026-11-12T10:01:00Z')],
    ['a same-date, different', shownAt],
  ])(
    'discards the copy shown when it asked, keeping %s copy written during the prompt',
    async (_, at) => {
      stored.keepRecovery('n', [{ clientId: 'shown' }], { sticky: true, now: shownAt })
      vi.spyOn(window, 'confirm').mockImplementation(() => {
        stored.keepRecovery('n', [{ clientId: 'written' }], { sticky: true, now: at })
        return true
      })

      await recovery().discardChanges()

      expect(stored.readRecovery('n').map((copy) => copy.slides)).toEqual([
        [{ clientId: 'written' }],
      ])
    },
  )
})
