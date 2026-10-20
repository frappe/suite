import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'

type SavedSlide = { client_id: string; background: string }
const serverSaves: SavedSlide[][] = []

// The network is the boundary: every save the editor sends lands here.
vi.mock('@/api', async (original) => {
  const real = await original<typeof import('@/api')>()
  const mutation = async (_operation: unknown, body: { slides: SavedSlide[] }) => {
    serverSaves.push(JSON.parse(JSON.stringify(body.slides)))
    return { modified: `saved-${serverSaves.length}` }
  }
  return { ...real, client: { ...real.client, mutation } }
})
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => undefined } }))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { presentationDoc, presentationId, slidesLength } =
  await import('@/apps/slides/stores/presentation')
const { changeSlide, slides } = await import('@/apps/slides/stores/slide')
const { dirty, getPresentationFromLocalDB, markClean, markDirty } =
  await import('@/apps/slides/stores/saving')
const { AUTOSAVE_INTERVAL_MS, useAutosave } = await import('./autosave')

const slide = (clientId: string) => ({ clientId, background: '#ffffffff', elements: [] })

let scope: EffectScope
const interacting = ref(false)

function openEditor() {
  scope = effectScope()
  scope.run(() =>
    useAutosave({
      editable: true,
      interacting,
      state: () => (dirty.value ? 'unsaved' : 'clean'),
    }),
  )
}

async function waitOneTick() {
  vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS)
  // the save runs through IndexedDB, which settles on real timers
  await vi.waitFor(() => expect(dirty.value).toBe(false))
}

describe('Slides autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    serverSaves.length = 0
    interacting.value = false
    const id = `deck-${Math.random()}`
    ;(presentationId as { value: string | null }).value = id
    presentationDoc.value = { name: id, modified: 'base' }
    slides.value = [slide('one'), slide('two'), slide('three')]
    slidesLength.value = 3
    markClean()
    openEditor()
  })

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  it('saves an edit on the second slide without the save shortcut', async () => {
    changeSlide(1)
    slides.value[1].background = '#ff0000ff'
    markDirty()

    await waitOneTick()

    expect(serverSaves).toHaveLength(1)
    expect(serverSaves[0][1].background).toBe('#ff0000ff')
  })

  it('keeps a local copy, and sends nothing, while an element is being dragged', async () => {
    interacting.value = true
    slides.value[2].background = '#00ff00ff'
    markDirty()

    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS)

    await vi.waitFor(async () => {
      const draft = await getPresentationFromLocalDB(presentationId.value)
      expect(draft?.content[2].background).toBe('#00ff00ff')
    })
    expect(serverSaves).toHaveLength(0)
    expect(dirty.value).toBe(true)
  })

  it('asks before the tab closes with unsaved edits, and not once they are saved', async () => {
    const closeTab = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }

    markDirty()
    expect(closeTab()).toBe(true)

    await waitOneTick()
    expect(closeTab()).toBe(false)
  })
})
