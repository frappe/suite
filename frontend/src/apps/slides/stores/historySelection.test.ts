import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { useCommandHistory } = await import('@/apps/slides/composables/useCommandHistory')
const { addElementCommand } = await import('./commands')
const { actionOrder, actions } = await import('./historyMeta')
const { activeElementIds, focusElementId } = await import('./element')
const { slides, slideIndex } = await import('./slide')

const slideId = 'c1'
const element = { id: 1, type: 'image', left: 64, top: 378, width: 620, height: 132 }

describe('selection after an element disappears', () => {
  beforeEach(() => {
    slides.value = [{ clientId: slideId, elements: [] }] as any
    slideIndex.value = 0
    activeElementIds.value = []
    focusElementId.value = null
  })

  it('drops the selection when undo removes the element it names', async () => {
    const history = useCommandHistory(slides, { actionOrder, actions })

    await history.execute(addElementCommand({ slideId, element }))
    await nextTick()

    expect(activeElementIds.value).toEqual([1])

    // adding a text element focuses it, which its own editor teardown covers
    focusElementId.value = 1

    await history.undo()
    await nextTick()

    expect(activeElementIds.value).toEqual([])
    expect(focusElementId.value).toBe(null)
  })
})
