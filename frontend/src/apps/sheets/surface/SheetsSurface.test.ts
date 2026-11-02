import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, nextTick, ref, watch } from 'vue'

import type { DocumentSession } from '@/apps/drive'

import { readRecovery } from './recovery'
import SheetsSurface from './SheetsSurface.vue'

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}))
vi.mock('frappe-ui', () => ({ toast }))
vi.mock('@/apps/drive', () => ({ DriveDocumentHeader: { render: () => null } }))
vi.mock('./SheetCommentsPanel.vue', () => ({ default: { render: () => null } }))
vi.mock('./SheetVersionsPanel.vue', () => ({ default: { render: () => null } }))
vi.mock('./navigation', () => ({ useDocumentLeaveGuard: vi.fn() }))

type Draft = { sheet: string; cell: string; value: string }

/** The live-room editor as the surface sees it (its `defineExpose`). */
const editor = vi.hoisted(() => ({
  saveState: 'clean' as 'clean' | 'saving' | 'unsaved' | 'failed',
  draft: null as Draft | null,
  loseAccess: vi.fn(),
}))
vi.mock('@/apps/sheets/components/SheetEditor/index.vue', () => ({
  default: defineComponent({
    props: { writable: Boolean },
    setup(props, { expose }) {
      // As the real editor: once view only, the cell editor closes, and the
      // room commits what it holds when access goes.
      watch(
        () => props.writable,
        (writable) => {
          if (!writable) editor.draft = null
        },
      )
      expose({
        activeCell: 'A1',
        currentSheet: 'Sheet1',
        isCollab: true,
        get saveState() {
          return editor.saveState
        },
        loseAccess: async (lost: string) => {
          editor.loseAccess(lost)
          editor.draft = null
        },
        regainAccess: async () => {},
        // The draft is read when it is called, the bytes after.
        workbookJson: () => {
          const draft = editor.draft
          return Promise.resolve(JSON.stringify({ engine: '', ...(draft ? { draft } : {}) }))
        },
        hasDraft: () => editor.draft !== null,
        flushSave: async () => {},
        goToCell: () => true,
        closeNotes: () => {},
      })
      return () => null
    },
  }),
}))

const state = ref('Active')
const role = ref(40)
const session = {
  nodeId: 'node-1',
  contentDocname: 'sheet-1',
  title: ref('Budget'),
  state,
  access: computed(() => ({ role: role.value })),
  credentials: { context: {}, fetch: vi.fn() },
  versions: {},
} as unknown as DocumentSession

let unmount: (() => void) | undefined
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  state.value = 'Active'
  role.value = 40
  Object.assign(editor, { saveState: 'clean', draft: null })
})
afterEach(() => unmount?.())

async function mountSurface() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(SheetsSurface, { session })
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  await nextTick()
}

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** The "Download my changes" toast, if one was shown. */
const downloadOffer = () =>
  toast.warning.mock.calls.find(([, options]) => options?.action?.label === 'Download my changes')

describe('SheetsSurface losing edit access in the live room', () => {
  it('offers edits that did not reach the server as a download, though the room keeps them too', async () => {
    await mountSurface()
    editor.saveState = 'unsaved'

    role.value = 20
    await settle()

    expect(downloadOffer()).toBeDefined()
    expect(readRecovery('node-1')).not.toBeNull()
    expect(editor.loseAccess).toHaveBeenCalledWith('lost_edit')
  })

  it('keeps the text still being typed in a cell when the sheet is trashed', async () => {
    await mountSurface()
    editor.draft = { sheet: 'Sheet1', cell: 'A2', value: '5150' }

    state.value = 'Trashed'
    await settle()

    expect(downloadOffer()).toBeDefined()
    const copy = JSON.parse(readRecovery('node-1')!.workbook)
    expect(copy.draft).toEqual({ sheet: 'Sheet1', cell: 'A2', value: '5150' })
  })

  it('offers nothing when every edit reached the server', async () => {
    await mountSurface()

    role.value = 20
    await settle()

    expect(downloadOffer()).toBeUndefined()
    expect(readRecovery('node-1')).toBeNull()
    expect(editor.loseAccess).toHaveBeenCalledWith('lost_edit')
  })
})
