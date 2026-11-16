import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App, type Ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { railHidden } from '@/platform/rail'

import DrawSurface from './DrawSurface.vue'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

interface Opened {
  readable: Ref<boolean>
  loadError: Ref<boolean>
  editable: Ref<boolean>
  conflict: Ref<boolean>
}
const drawing = vi.hoisted(() => ({
  opened: fromPartial<Opened | null>(null),
  // What the surface last told the shared header, null while it shows none
  header: fromPartial<Record<string, unknown> | null>(null),
}))

vi.mock('frappe-ui', () => ({ Button: { render: () => null } }))
vi.mock('@/apps/drive', () => ({
  useDriveDocumentCreation: () => ({}),
  driveNodeRoute: vi.fn(),
  DriveDocumentHeader: {
    inheritAttrs: false,
    render(this: { $attrs: Record<string, unknown> }) {
      drawing.header = { ...this.$attrs }
      return null
    },
    unmounted() {
      drawing.header = null
    },
  },
}))
vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
  useRouter: vi.fn(),
}))
vi.mock('../App.vue', () => ({ default: { render: () => null } }))
vi.mock('../canvas/persistence', async () => {
  const { ref } = await import('vue')
  return {
    DRAWING_PERSISTENCE: Symbol('persistence'),
    DrawingPersistence: class {
      dirty = ref(false)
      saving = ref(false)
      error = ref('')
      conflict = ref(false)
      loadError = ref(false)
      editable = ref(true)
      recoveryAvailable = ref(true)
      recoveryAllowed = ref(true)
      drawingLoading = ref(false)
      readable = ref(true)
      saveDrawing = vi.fn()
      retainRecovery = vi.fn()
      dispose = vi.fn()
      constructor() {
        drawing.opened = this
      }
    },
  }
})

let app: App | null = null

function openDrawing() {
  app = createApp(DrawSurface, { session: fromPartial<DocumentSession>({}) })
  app.mount(document.createElement('div'))
  return drawing.opened!
}

afterEach(() => {
  app?.unmount()
  app = null
})

it('hides the rail while the drawing is open, and gives it back on leaving', () => {
  openDrawing()
  expect(railHidden.value).toBe(true)

  app?.unmount()
  app = null
  expect(railHidden.value).toBe(false)
})

it('brings the rail back when the drawing fails to load', async () => {
  const opened = openDrawing()
  expect(railHidden.value).toBe(true)

  opened.loadError.value = true
  await nextTick()

  expect(railHidden.value).toBe(false)
})

it('brings the rail back when read access goes', async () => {
  const opened = openDrawing()
  expect(railHidden.value).toBe(true)

  opened.readable.value = false
  await nextTick()

  expect(railHidden.value).toBe(false)
})

it('shows the shared header, with the drawing’s title in it', () => {
  openDrawing()
  expect(drawing.header).toMatchObject({ 'title-label': 'Drawing title', 'view-only': false })
})

it('says view only for a reader, and editing paused once the saved drawing changed', async () => {
  const opened = openDrawing()

  opened.editable.value = false
  await nextTick()
  expect(drawing.header).toMatchObject({ 'view-only': true, 'state-badge': '' })

  opened.conflict.value = true
  await nextTick()
  expect(drawing.header).toMatchObject({ 'state-badge': 'Editing paused' })
})

it('shows no header once read access goes', async () => {
  const opened = openDrawing()

  opened.readable.value = false
  await nextTick()

  expect(drawing.header).toBeNull()
})
