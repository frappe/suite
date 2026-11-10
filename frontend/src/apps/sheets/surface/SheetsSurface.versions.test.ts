import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, ref } from 'vue'
import * as Y from 'yjs'

import type { DocumentSession } from '@/apps/drive'

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
    { props: Record<string, unknown>; showChanges: unknown[]; goTo: string[] }[]
  >([]),
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
vi.mock('./SheetDocumentMenu.vue', () => capture('menu'))
vi.mock('./SheetVersionsPanel.vue', () => capture('panel'))
vi.mock('./SheetVersionBar.vue', () => capture('bar'))
vi.mock('./SheetCommentsPanel.vue', () => ({ default: { render: () => null } }))

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
      }
      seen.editors.push(record)
      expose({
        activeCell: 'A1',
        currentSheet: 'Sheet1',
        saveState: 'clean',
        isCollab: !props.version,
        flushSave: async () => {},
        whenLoaded: async () => {},
        docState: () => (props.version ? null : docs.live),
        showChanges: (cells: unknown) => record.showChanges.push(cells),
        goToCell: (sheet: string, cell: string) => {
          record.goTo.push(`${sheet}!${cell}`)
          return true
        },
        closeNotes: () => {},
        hasDraft: () => false,
        hasUnsentWork: () => false,
      })
      return () =>
        h('div', [
          slots.header?.({ viewOnly: false, status: null, menus: null, actions: null }),
          slots.banner?.(),
          slots['side-panel']?.(),
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
const version = {
  seq: 3,
  kind: 'named',
  label: 'Before import',
  pinned: 0,
  actor: 'ann@example.com',
  creation: null,
}

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
    list: vi.fn(async () => ({ rows: [version], next_cursor: null })),
    contentUrl: (seq: string) => `/versions/${seq}/content`,
  },
})

let unmount: (() => void) | undefined
beforeEach(() => {
  vi.clearAllMocks()
  seen.editors = []
  seen.panel = seen.bar = null
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

describe('SheetsSurface version preview', () => {
  it('shows a version read-only in place of the live sheet and washes the cells it changed', async () => {
    await openVersions()
    const [row] = versionRows()

    seen.panel!.emit('preview', row)
    await settle()

    expect(fetchVersion).toHaveBeenCalledWith('/versions/3/content')
    const shown = lastEditor()
    expect(shown.props.version).toBeInstanceOf(Uint8Array)
    expect(shown.props.collabSession).toBeNull()
    expect(shown.props.writable).toBe(false)
    expect(shown.showChanges).toEqual([[{ sheet: 'Sheet1', cell: 'A1' }]])
    expect(seen.panel!.props.previewed).toBe('3')
  })

  it('steps to each changed cell, and back to the live sheet on exit', async () => {
    await openVersions()
    const [row] = versionRows()
    seen.panel!.emit('preview', row)
    await settle()

    seen.bar!.emit('step', 1)
    await settle()
    expect(lastEditor().goTo).toEqual(['Sheet1!A1'])
    expect(seen.bar!.props.step).toBe(0)

    seen.bar!.emit('exit')
    await settle()
    expect(lastEditor().props.version).toBeNull()
    expect(lastEditor().props.collabSession).toBe(session)
    expect(seen.panel!.props.previewed).toBeNull()
  })

  it('ends the preview when the Versions panel closes', async () => {
    await openVersions()
    const [row] = versionRows()
    seen.panel!.emit('preview', row)
    await settle()

    seen.panel!.emit('close')
    await settle()

    expect(lastEditor().props.version).toBeNull()
  })
})

function versionRows() {
  const list = seen.panel?.props.list
  if (!list || typeof list !== 'object' || !('versions' in list))
    throw new Error('Expected a versions panel')
  const versions = list.versions
  if (
    !versions ||
    typeof versions !== 'object' ||
    !('value' in versions) ||
    !Array.isArray(versions.value)
  )
    throw new Error('Expected version rows')
  return versions.value
}
