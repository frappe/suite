import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'

import InfiniteCanvas from '../components/InfiniteCanvas.vue'
import { readDrafts, removeDraft, writeDraft } from './drafts'
import { DRAWING_PERSISTENCE, DrawingPersistence } from './persistence'

const network = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }))
vi.mock('@/api', () => ({
  api: { draw: { documents: { get: 'get', save: 'save' } } },
  client: network,
}))
vi.mock('@/platform/session', () => ({
  useSession: () => ({ user: ref({ id: 'artist@example.com' }) }),
}))
vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))

const rectangle = {
  id: 'rectangle',
  x: 10,
  y: 10,
  width: 80,
  height: 40,
  rotation: 0,
  cornerRadius: 0,
}
const scene = { rectangles: [rectangle], lines: [] }
let unmount: (() => void) | undefined
let persistence: DrawingPersistence
async function editor(loadedScene: unknown = scene, contentDocname = crypto.randomUUID()) {
  network.query.mockResolvedValue({ content: JSON.stringify(loadedScene), modified: 'original' })
  network.mutation.mockResolvedValue({ modified: 'saved' })
  persistence = new DrawingPersistence(
    fromPartial<DocumentSession>({
      contentDocname,
      nodeId: 'node',
      title: ref('Drawing'),
      state: ref('Active'),
      access: ref({ role: 40 }),
      credentials: { context: {} },
    }),
  )
  return persistence
}
afterEach(() => {
  unmount?.()
  unmount = undefined
  persistence?.dispose()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it('loads legacy freehand artwork with no pressure samples', async () => {
  const stroke = {
    id: 'stroke',
    kind: 'freedraw',
    x: 12,
    y: 23,
    width: 28,
    height: 27,
    rotation: 0,
    cornerRadius: 0,
    points: [
      { x: 12, y: 23 },
      { x: 40, y: 50 },
    ],
    simulatePressure: true,
  }
  const legacyScene = { rectangles: [stroke], lines: [] }
  const save = await editor(legacyScene)

  expect(await save.loadDrawing()).toEqual({
    rectangles: [{ ...stroke, pressures: [0.5, 0.5] }],
    lines: [],
  })
  expect(save.loadError.value).toBe(false)
  expect(legacyScene.rectangles[0]).toEqual(stroke)
})

it('keeps newer text drafts when an older scene save is acknowledged', async () => {
  const save = await editor()
  await save.loadDrawing()
  let acknowledge!: (value: { modified: string }) => void
  network.mutation.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve
      }),
  )
  save.queueSave(scene)
  const pending = save.saveDrawing()
  const newer = { rectangles: [{ ...rectangle, x: 95 }], lines: [] }
  save.retainScene(newer)
  acknowledge({ modified: 'saved' })
  await pending
  await save.retainRecovery()
  expect(save.dirty.value).toBe(true)
  const drafts = await readDrafts(`artist@example.com:${save.session.contentDocname}`)
  expect(drafts).toHaveLength(1)
  expect(drafts[0]!.value.content.rectangles[0]!.x).toBe(95)
  expect(drafts[0]!.value.baseModified).toBe('saved')
})

/** Saves `edit` from a tab that reloads before the server's answer arrives. */
async function reloadDuringSave(edit: typeof scene): Promise<string> {
  const empty = { rectangles: [], lines: [] }
  const first = await editor(empty)
  await first.loadDrawing()
  network.mutation.mockReturnValueOnce(new Promise(() => {}))
  first.queueSave(edit)
  void first.saveDrawing()
  await first.retainRecovery()
  await vi.waitFor(() => expect(network.mutation).toHaveBeenCalledOnce())
  return first.session.contentDocname
}

it('reopens cleanly when the save sent before a reload reached the server', async () => {
  const drawing = await reloadDuringSave(scene)
  const reopened = await editor(scene, drawing)
  network.query.mockResolvedValue({ content: JSON.stringify(scene), modified: 'saved' })

  expect(await reopened.loadDrawing()).toEqual(scene)
  expect(reopened.conflict.value).toBe(false)
  expect(reopened.dirty.value).toBe(false)
  expect(reopened.editable.value).toBe(true)
  await reopened.retainRecovery()
  expect(await readDrafts(`artist@example.com:${drawing}`)).toEqual([])
})

it('still pauses editing when someone else saved over the draft', async () => {
  const drawing = await reloadDuringSave(scene)
  const theirs = { rectangles: [{ ...rectangle, id: 'theirs', x: 300 }], lines: [] }
  const reopened = await editor(scene, drawing)
  network.query.mockResolvedValue({ content: JSON.stringify(theirs), modified: 'theirs' })

  expect(await reopened.loadDrawing()).toEqual(scene)
  expect(reopened.conflict.value).toBe(true)
  expect(reopened.editable.value).toBe(false)
  const drafts = await readDrafts(`artist@example.com:${drawing}`)
  expect(drafts.map((draft) => draft.value.content)).toEqual([scene])
})

it('does not remove another revision or another editor draft', async () => {
  const prefix = crypto.randomUUID()
  const older = { content: scene, revision: 'old' }
  const newer = { content: scene, revision: 'new' }
  await writeDraft(`${prefix}:first`, older)
  await writeDraft(`${prefix}:second`, newer)
  await writeDraft(`${prefix}:first`, newer)
  await removeDraft({ key: `${prefix}:first`, value: older })
  expect((await readDrafts(prefix)).map((entry) => entry.value.revision)).toEqual(['new', 'new'])
})

it('flushes the pending rectangle after dismissing a blank text editor', async () => {
  const save = await editor()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(InfiniteCanvas, { activeTool: 'text' }) })
  app.provide(DRAWING_PERSISTENCE, save)
  app.mount(host)
  unmount = () => {
    app.unmount()
    host.remove()
  }
  await vi.waitFor(() => expect(save.editable.value).toBe(true))
  await nextTick()
  await nextTick()
  save.queueSave(scene)
  const canvas = host.querySelector<HTMLElement>('.infinite-canvas')!
  canvas.setPointerCapture = () => {}
  canvas.hasPointerCapture = () => false
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      bubbles: true,
      clientX: 200,
      clientY: 200,
      button: 0,
    }),
  )
  canvas.dispatchEvent(
    new PointerEvent('pointerup', {
      pointerId: 1,
      pointerType: 'mouse',
      bubbles: true,
      clientX: 200,
      clientY: 200,
      button: 0,
    }),
  )
  await nextTick()
  const input = host.querySelector('textarea')!
  expect(input).not.toBeNull()
  input.dispatchEvent(new FocusEvent('blur'))
  await nextTick()
  await save.saveDrawing()
  expect(network.mutation).toHaveBeenCalledOnce()
  expect(JSON.parse(network.mutation.mock.calls[0]![1].content).rectangles).toEqual([rectangle])
  expect(save.dirty.value).toBe(false)
})
