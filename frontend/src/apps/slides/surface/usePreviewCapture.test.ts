import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef, type EffectScope } from 'vue'

type PreviewPush = { node: string; image: string; mime: string }
const pushedPreviews: PreviewPush[] = []
let serverRefusesSaves = false
let saves = 0

// The network and the drawing library are the boundaries.
vi.mock('@/api', async (original) => {
  const real = await original<typeof import('@/api')>()
  const mutation = async (operation: unknown, body: PreviewPush) => {
    if (operation === real.api.drive.nodes.setPreview) {
      pushedPreviews.push(body)
      return { preview: null }
    }
    if (serverRefusesSaves) throw new Error('The server is unavailable')
    return { modified: `saved-${++saves}` }
  }
  return { ...real, client: { ...real.client, mutation } }
})
const drawings = vi.hoisted(() => ({ count: 0, finish: Promise.resolve() }))
vi.mock('modern-screenshot', () => ({
  domToWebp: async () => {
    drawings.count++
    await drawings.finish
    return 'data:image/webp;base64,UklGRg=='
  },
}))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => undefined } }))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { presentationDoc, presentationId, slidesLength, viewOnly } =
  await import('@/apps/slides/stores/presentation')
const { slides } = await import('@/apps/slides/stores/slide')
const { clearSaveFailure, markClean, markDirty, saveChanges } =
  await import('@/apps/slides/stores/saving')
const { usePreviewCapture } = await import('./usePreviewCapture')

const slide = (clientId: string) => ({ clientId, background: '#ffffffff', elements: [] })

let scope: EffectScope
let preview: ReturnType<typeof usePreviewCapture> | undefined
let frame: HTMLElement

async function editAndSave(index = 0) {
  slides.value[index].background = `#${Math.random().toString(16).slice(2, 8)}ff`
  markDirty()
  await saveChanges()
  await nextTick()
}

async function waitOutThePause() {
  await vi.advanceTimersByTimeAsync(5_000)
}

describe('the deck preview', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    pushedPreviews.length = 0
    drawings.count = 0
    drawings.finish = Promise.resolve()
    serverRefusesSaves = false
    viewOnly.value = false
    clearSaveFailure()
    const id = `deck-${Math.random()}`
    presentationId.value = id
    presentationDoc.value = { name: id, modified: 'base' }
    slides.value = [slide('one'), slide('two')]
    slidesLength.value = 2
    markClean()
    frame = document.body.appendChild(document.createElement('div'))
    scope = effectScope()
    preview = scope.run(() => usePreviewCapture({ node: 'deck-node', target: shallowRef(frame) }))
  })

  afterEach(() => {
    scope.stop()
    frame.remove()
    vi.useRealTimers()
  })

  it('sends one picture of the first slide once the saves pause', async () => {
    await editAndSave()
    await editAndSave()
    await waitOutThePause()

    await vi.waitFor(() => expect(pushedPreviews).toHaveLength(1))
    expect(drawings.count).toBe(1)
    expect(pushedPreviews[0]).toEqual({ node: 'deck-node', image: 'UklGRg==', mime: 'image/webp' })
  })

  it('waits 5 seconds from the last save, so a later save starts the wait again', async () => {
    await editAndSave()
    await vi.advanceTimersByTimeAsync(3_000)
    await editAndSave()

    await vi.advanceTimersByTimeAsync(4_900)
    expect(drawings.count).toBe(0)
    expect(pushedPreviews).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(100)
    await vi.waitFor(() => expect(pushedPreviews).toHaveLength(1))
    expect(drawings.count).toBe(1)
  })

  it('sends nothing when a save leaves the first slide as it was sent', async () => {
    await editAndSave()
    await waitOutThePause()
    await vi.waitFor(() => expect(pushedPreviews).toHaveLength(1))

    await editAndSave(1)
    await waitOutThePause()

    expect(drawings.count).toBe(1)
    expect(pushedPreviews).toHaveLength(1)
  })

  it('sends nothing once cancelled, whether it is waiting or drawing, and the next save sends again', async () => {
    await editAndSave()
    preview?.cancelCapture()
    await waitOutThePause()
    expect(drawings.count).toBe(0)

    let finishDrawing = () => {}
    drawings.finish = new Promise((resolve) => (finishDrawing = resolve))
    await editAndSave()
    await waitOutThePause()
    expect(drawings.count).toBe(1)
    preview?.cancelCapture()
    finishDrawing()
    await vi.advanceTimersByTimeAsync(0)
    expect(pushedPreviews).toHaveLength(0)

    await editAndSave()
    await waitOutThePause()
    await vi.waitFor(() => expect(pushedPreviews).toHaveLength(1))
  })

  it('sends nothing from a view only tab', async () => {
    viewOnly.value = true
    await editAndSave()
    await waitOutThePause()

    expect(drawings.count).toBe(0)
    expect(pushedPreviews).toHaveLength(0)
  })

  it('sends nothing after a save the server refused', async () => {
    serverRefusesSaves = true
    await editAndSave()
    await waitOutThePause()

    expect(drawings.count).toBe(0)
    expect(pushedPreviews).toHaveLength(0)
  })
})
