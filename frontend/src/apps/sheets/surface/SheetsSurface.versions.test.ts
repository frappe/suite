import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, ref } from 'vue'
import * as Y from 'yjs'

import type { DocumentSession, DocumentVersion } from '@/apps/drive'

import { addSheet, axis, cellKey, initDoc, roots } from '../collab/schema'
import SheetsSurface from './SheetsSurface.vue'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const ui = vi.hoisted(() => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
  dialog: { prompt: vi.fn(), confirm: vi.fn() },
}))
vi.mock('frappe-ui', () => ui)
vi.mock('./navigation', () => ({ useDocumentLeaveGuard: vi.fn() }))

type Emit = (event: string, ...args: unknown[]) => void
/** What the mocked children last rendered with, so a test can act as the person would. */
const seen = vi.hoisted(() => ({
  menu: fromPartial<{ emit: Emit; props: Record<string, unknown> } | null>(null),
  panel: fromPartial<{ emit: Emit; props: Record<string, unknown> } | null>(null),
  bar: fromPartial<{ emit: Emit; props: Record<string, unknown> } | null>(null),
  editors: fromPartial<
    { props: Record<string, unknown>; showChanges: unknown[]; goTo: string[]; exports: number }[]
  >([]),
  /** How many times the side panel was made anew. */
  panelMounts: 0,
  /** Set to hold every new editor's load open until the test lets it go. */
  loadGate: fromPartial<Promise<void> | null>(null),
}))
vi.mock('@/apps/drive', async () => {
  const { defineComponent } = await import('vue')
  return {
    driveNodeRoute: (node: string) => ({ path: `/d/${node}` }),
    DriveDocumentHeader: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          slots.menu?.(),
    }),
    DriveDocumentMenu: capture('menu').default,
    useDocumentComments: () => ({ drafts: { start: () => {} } }),
  }
})
function capture(key: 'menu' | 'panel' | 'bar') {
  return {
    default: defineComponent({
      inheritAttrs: false,
      setup: (_props, { attrs }) => {
        const emit: Emit = (event, ...args) => {
          const name = `on${event[0]!.toUpperCase()}${event.slice(1)}`
          const listener = attrs[name]
          if (typeof listener === 'function') listener(...args)
        }
        return () => {
          seen[key] = { emit, props: attrs }
          return null
        }
      },
    }),
  }
}
vi.mock('./SheetVersionBar.vue', () => capture('bar'))
// The side panel as the surface sees it: its two models, and a mark for where it sits on the page
vi.mock('./SheetSidePanel.vue', () => ({
  default: defineComponent({
    inheritAttrs: false,
    props: {
      panel: { type: String, default: null },
      previewedVersion: { type: Object, default: null },
    },
    setup: (props, { attrs, expose }) => {
      seen.panelMounts++
      expose({ reloadVersions: async () => {} })
      const emit: Emit = (event, ...args) => {
        const listener = attrs[`on${event[0]!.toUpperCase()}${event.slice(1)}`]
        if (typeof listener === 'function') listener(...args)
      }
      return () => {
        seen.panel = { emit, props: { ...props } }
        return h('aside', { 'data-side-panel': '' })
      }
    },
  }),
}))

/** The live sheet: A1 = "now". Version 3 held A1 = "then". */
const docs = vi.hoisted(() => ({ live: fromPartial<Uint8Array | null>(null) }))
vi.mock('@/apps/sheets/components/SheetEditor/index.vue', () => ({
  default: defineComponent({
    props: {
      writable: Boolean,
      version: { type: Uint8Array, default: null },
      collabSession: { type: Object, default: null },
    },
    setup(props, { expose, slots }) {
      const record = {
        props,
        showChanges: fromPartial<unknown[]>([]),
        goTo: fromPartial<string[]>([]),
        exports: 0,
      }
      seen.editors.push(record)
      const gate = seen.loadGate
      expose({
        activeCell: 'A1',
        currentSheet: 'Sheet1',
        saveState: 'clean',
        isCollab: !props.version,
        flushSave: async () => {},
        whenLoaded: async () => {
          await gate
        },
        docState: () => (props.version ? null : docs.live),
        showChanges: (cells: unknown) => record.showChanges.push(cells),
        goToCell: (sheet: string, cell: string) => {
          record.goTo.push(`${sheet}!${cell}`)
          return true
        },
        closeNotes: () => {},
        exportXLSX: async () => {
          record.exports++
        },
        hasDraft: () => false,
        hasUnsentWork: () => false,
      })
      return () =>
        h('div', { 'data-editor': '' }, [
          slots.header?.({
            viewOnly: false,
            status: null,
            menus: null,
            actions: null,
            menuItems: { transfer: [], settings: [] },
          }),
          slots.banner?.(),
          slots.aside?.(),
        ])
    },
  }),
}))

function sheetDoc(cells: Record<string, string>) {
  const doc = new Y.Doc()
  initDoc(doc)
  const id = addSheet(doc, 'Sheet1')
  doc.transact(() => {
    for (const [at, input] of Object.entries(cells)) {
      const [row, col] = at.split(',').map(Number)
      if (row === undefined || col === undefined)
        throw new Error('Expected a row,column cell address')
      roots(doc).inputs.set(
        cellKey(id, axis(doc, id, 'rows').ensure(row), axis(doc, id, 'cols').ensure(col)),
        input,
      )
    }
  })
  return doc
}
const versionDoc = sheetDoc({ '0,0': 'then', '3,2': '=A1' })
const stored = new TextEncoder().encode(
  JSON.stringify({
    schema: 'sheets-document/2',
    codec: 'yjs1',
    lineage: 'l',
    state: gzipSync(Y.encodeStateAsUpdate(versionDoc)).toString('base64'),
  }),
)
const version = fromPartial<DocumentVersion>({
  seq: 3,
  kind: 'named',
  label: 'Before import',
  pinned: 0,
  actor: 'ann@example.com',
  person: { id: 'ann@example.com', full_name: 'Ann Lee', user_image: null },
  creation: null,
})

const newer = fromPartial<DocumentVersion>({ ...version, seq: 4, label: 'After import' })
const fetchVersion = vi.fn(async () => new Response(stored))
const session = fromPartial<DocumentSession>({
  nodeId: 'node-1',
  contentDocname: 'sheet-1',
  title: ref('Budget'),
  state: ref('Active'),
  access: computed(() => ({ role: 40 })),
  panels: ref(['comments', 'versions']),
  folder: ref({ name: 'folder-1', title: 'Finance' }),
  credentials: { context: {}, fetch: fetchVersion },
  versions: {
    contentUrl: (seq: string) => `/versions/${seq}/content`,
  },
})

let unmount: (() => void) | undefined
beforeEach(() => {
  vi.clearAllMocks()
  seen.editors = []
  seen.panel = seen.bar = null
  seen.panelMounts = 0
  seen.loadGate = null
  const live = new Y.Doc()
  Y.applyUpdate(live, Y.encodeStateAsUpdate(versionDoc))
  const sheetId = roots(live).sheets.get(0)
  live.transact(() => {
    const key = cellKey(
      sheetId,
      axis(live, sheetId, 'rows').idAt(0)!,
      axis(live, sheetId, 'cols').idAt(0)!,
    )
    roots(live).inputs.set(key, 'now')
  })
  docs.live = Y.encodeStateAsUpdate(live)
})
afterEach(() => unmount?.())

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function openVersions() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(SheetsSurface, { session })
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  await settle()
  seen.menu!.emit('togglePanel', 'versions')
  await settle()
}
const lastEditor = () => seen.editors.at(-1)!

/** As a click on the version in the panel's list. */
async function show(shown: DocumentVersion) {
  seen.panel!.emit('update:previewedVersion', shown)
  await settle()
}

describe('SheetsSurface version preview', () => {
  it('shows a version read-only in place of the live sheet and washes the cells it changed', async () => {
    await openVersions()

    await show(version)

    expect(fetchVersion).toHaveBeenCalledWith('/versions/3/content')
    const shown = lastEditor()
    expect(shown.props.version).toBeInstanceOf(Uint8Array)
    expect(shown.props.collabSession).toBeNull()
    expect(shown.props.writable).toBe(false)
    expect(shown.showChanges).toEqual([[{ sheet: 'Sheet1', cell: 'A1' }]])
    expect(seen.panel!.props.previewedVersion).toEqual(version)
  })

  it('steps to each changed cell, and back to the live sheet on exit', async () => {
    await openVersions()
    await show(version)

    seen.bar!.emit('step', 1)
    await settle()
    expect(lastEditor().goTo).toEqual(['Sheet1!A1'])
    expect(seen.bar!.props.step).toBe(0)

    seen.bar!.emit('exit')
    await settle()
    expect(lastEditor().props.version).toBeNull()
    expect(lastEditor().props.collabSession).toBe(session)
    expect(seen.panel!.props.previewedVersion).toBeNull()
  })

  it('keeps the version shown when the Versions panel closes, until Back', async () => {
    await openVersions()
    await show(version)

    seen.panel!.emit('update:panel', null)
    await settle()

    expect(lastEditor().props.version).toBeInstanceOf(Uint8Array)
    expect(seen.bar!.props.preview).toMatchObject({ version: { seq: 3 } })

    seen.bar!.emit('exit')
    await settle()
    expect(lastEditor().props.version).toBeNull()
  })

  it('goes back to the live sheet when Comments opens over a shown version', async () => {
    await openVersions()
    await show(version)

    seen.menu!.emit('togglePanel', 'comments')
    await settle()

    expect(lastEditor().props.version).toBeNull()
    expect(lastEditor().props.collabSession).toBe(session)
  })

  it('goes back to the live sheet on Escape from the panel', async () => {
    await openVersions()
    await show(version)

    seen.panel!.emit('back')
    await settle()

    expect(lastEditor().props.version).toBeNull()
    expect(seen.panel!.props.panel).toBe('versions')
  })

  it('keeps the one panel beside the grid while the editor is made anew for a version', async () => {
    await openVersions()
    const editorsBefore = seen.editors.length

    await show(version)

    expect(seen.editors.length).toBeGreaterThan(editorsBefore)
    expect(seen.panelMounts).toBe(1)
    expect(document.querySelectorAll('[data-editor] [data-side-panel]')).toHaveLength(1)
  })

  it('takes a new name for the version it shows without reading it again', async () => {
    await openVersions()
    await show(version)
    const editors = seen.editors.length

    await show({ ...version, label: 'After import' })

    expect(seen.bar!.props.preview).toMatchObject({ version: { seq: 3, label: 'After import' } })
    expect(fetchVersion).toHaveBeenCalledOnce()
    expect(seen.editors).toHaveLength(editors)
  })

  it('still shows a newer pick when a rename of the version it left lands before it loads', async () => {
    await openVersions()
    await show(version)
    let send = (_: Response) => {}
    fetchVersion.mockReturnValueOnce(new Promise((resolve) => (send = resolve)))

    await show(newer)
    // The panel hands a new name back only for the version it holds, so this rename stays with it
    expect(seen.panel!.props.previewedVersion).toMatchObject({ seq: 4 })
    send(new Response(stored))
    await settle()

    expect(seen.bar!.props.preview).toMatchObject({ version: { seq: 4, label: 'After import' } })
  })

  it('keeps the version shown when it is picked again before another one has loaded', async () => {
    await openVersions()
    await show(version)
    let send = (_: Response) => {}
    fetchVersion.mockReturnValueOnce(new Promise((resolve) => (send = resolve)))

    await show(newer)
    await show(version)
    send(new Response(stored))
    await settle()

    expect(seen.bar!.props.preview).toMatchObject({ version: { seq: 3 } })
    expect(seen.panel!.props.previewedVersion).toMatchObject({ seq: 3 })
  })

  it('shows a version under the name it got while it loaded, reading it once', async () => {
    await openVersions()
    let send = (_: Response) => {}
    fetchVersion.mockReturnValueOnce(new Promise((resolve) => (send = resolve)))

    await show(newer)
    await show({ ...newer, label: 'Renamed' })
    send(new Response(stored))
    await settle()

    expect(seen.bar!.props.preview).toMatchObject({ version: { seq: 4, label: 'Renamed' } })
    expect(fetchVersion).toHaveBeenCalledOnce()
  })

  it('goes back to the version shown in the panel when the next pick can’t be read', async () => {
    await openVersions()
    await show(version)
    fetchVersion.mockRejectedValueOnce(new Error('offline'))

    await show(newer)

    expect(seen.bar!.props.preview).toMatchObject({ version: { seq: 3 } })
    expect(seen.panel!.props.previewedVersion).toMatchObject({ seq: 3 })
  })

  it('downloads a version as the Excel file of the sheet it shows', async () => {
    await openVersions()
    const live = lastEditor()

    seen.panel!.emit('downloadVersion', version)
    await settle()

    const shown = lastEditor()
    expect(shown.props.version).toBeInstanceOf(Uint8Array)
    expect(shown.exports).toBe(1)
    expect(live.exports).toBe(0)
  })

  it('downloads a version picked a moment before, once its one read has landed', async () => {
    await openVersions()
    let send = (_: Response) => {}
    fetchVersion.mockReturnValueOnce(new Promise((resolve) => (send = resolve)))

    await show(version)
    seen.panel!.emit('downloadVersion', version)
    send(new Response(stored))
    await settle()

    expect(lastEditor().props.version).not.toBeNull()
    expect(lastEditor().exports).toBe(1)
    expect(fetchVersion).toHaveBeenCalledOnce()
  })

  it('exports nothing when another version is picked while the download loads its sheet', async () => {
    await openVersions()
    let letLoad = () => {}
    seen.loadGate = new Promise((resolve) => (letLoad = resolve))

    seen.panel!.emit('downloadVersion', version)
    await settle()
    await show({ ...version, seq: 4, label: 'After import' })
    letLoad()
    await settle()

    expect(seen.bar!.props.preview).toMatchObject({ version: { seq: 4 } })
    expect(seen.editors.map((editor) => editor.exports)).not.toContain(1)
  })

  it('exports nothing when the way back is taken while the download reads its version', async () => {
    await openVersions()
    let send = (_: Response) => {}
    fetchVersion.mockReturnValueOnce(new Promise((resolve) => (send = resolve)))

    seen.panel!.emit('downloadVersion', version)
    await settle()
    seen.panel!.emit('update:previewedVersion', null)
    send(new Response(stored))
    await settle()

    expect(lastEditor().props.version).toBeNull()
    expect(seen.editors.map((editor) => editor.exports)).not.toContain(1)
  })
})
