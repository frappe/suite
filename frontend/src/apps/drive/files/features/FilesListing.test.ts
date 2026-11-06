import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, watch } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'
import { requireTestElement } from '@/platform/testing/dom'
import { DOCUMENT_TYPES_KEY, type DocumentTypeDefinition } from '@/platform/contracts'
import { setTweaks } from '@/platform/tweaks'

import FilesListing from './FilesListing.vue'
import { DEFAULT_PRESENTATION, type PresentationState } from './presentation'
import { useListingSelection } from './useListingSelection'

/** The New menu's document types, as composition registers them. */
const NEW_MENU_TYPES: DocumentTypeDefinition[] = (
  [
    ['writer', 'Writer Document', 'Document'],
    ['sheets', 'Sheet', 'Spreadsheet'],
    ['slides', 'Presentation', 'Presentation'],
    ['draw', 'Drawing', 'Drawing'],
  ] as const
).map(([key, contentDoctype, label]) => ({
  key,
  contentDoctype,
  newLabel: () => label,
  icon: {},
  loadSurface: async () => ({}),
}))

let cleanup: (() => void) | undefined
let intersect: IntersectionObserverCallback
beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback
      }
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup?.()
  vi.unstubAllGlobals()
  setTweaks(['t4-type-names', 't13-arrow-keys', 't13-type-ahead'], true)
})

function file(name: string, title: string, extra: Partial<DriveNode> = {}): DriveNode {
  return {
    name,
    title,
    kind: 'File',
    parent_node: 'root',
    root: 'root',
    state: 'Active',
    trash_root: null,
    size: 10,
    mime: 'image/png',
    url: null,
    content_doctype: null,
    content_docname: null,
    is_template: 0,
    owner: { id: 'someone@example.com', full_name: 'Someone Else', user_image: null },
    creation: null,
    modified: null,
    content_modified: null,
    ...extra,
  }
}

function mount(options: {
  rows: DriveNode[]
  view?: PresentationState['view']
  columns?: string[]
  selection?: string[]
  status?: 'pending' | 'success' | 'error'
}) {
  const state = reactive({ selection: options.selection ?? [] })
  type ListingEvents = { previewErrors: string[]; opened: string[] }
  const events: ListingEvents = { previewErrors: [], opened: [] }
  const query = reactive({
    status: options.status ?? 'success',
    rows: options.rows,
    error: null,
    hasNext: false,
    isFetching: false,
    isFetchingNext: false,
    refetch() {},
    fetchNext() {},
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  // The selection lives where the page keeps it.
  const app = createApp({
    setup() {
      const picked = useListingSelection(() => query.rows.map((row) => row.name))
      picked.selected.value = state.selection
      watch(picked.selected, (selected) => {
        state.selection = selected
      })
      return () =>
        h(FilesListing, {
          query: fromPartial<InstanceType<typeof FilesListing>['$props']['query']>(query),
          presentation: {
            ...DEFAULT_PRESENTATION,
            view: options.view ?? 'list',
            columns: options.columns ?? DEFAULT_PRESENTATION.columns,
          },
          selection: picked.selected.value,
          selectionMode: picked.selectionMode.value,
          emptyTitle: 'Empty',
          emptyDescription: '',
          menuOptions: () => [],
          'onUpdate:selection': (value: string[]) => {
            picked.selected.value = value
          },
          onSelect: (node: DriveNode, range: boolean) => picked.toggle(node.name, range),
          onExtend: (from: DriveNode, to: DriveNode) => picked.extend(from.name, to.name),
          onOpen: (node: DriveNode) => {
            events.opened.push(node.name)
          },
          onPreviewError: (node: DriveNode) => {
            events.previewErrors.push(node.name)
          },
        })
    },
  })
  app.provide(DOCUMENT_TYPES_KEY, NEW_MENU_TYPES)
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return { root, state, events, query }
}

const rows = [file('a', 'Alpha.png'), file('b', 'Beta.png')]

describe('FilesListing paging', () => {
  it('waits for a refresh to finish before loading a visible next window', async () => {
    const { query } = mount({ rows })
    query.hasNext = true
    query.isFetching = true
    const fetchNext = vi.spyOn(query, 'fetchNext').mockImplementation(() => {
      query.hasNext = false
    })

    intersect(
      [fromPartial<IntersectionObserverEntry>({ isIntersecting: true })],
      fromPartial<IntersectionObserver>({}),
    )
    await nextTick()
    expect(fetchNext).not.toHaveBeenCalled()

    query.isFetching = false
    await nextTick()
    expect(fetchNext).toHaveBeenCalledOnce()
  })

  it('waits for an explicit retry after a next window fails', async () => {
    const { root, query } = mount({ rows })
    Object.assign(query, { hasNext: true, error: new Error('Window failed') })
    const fetchNext = vi.spyOn(query, 'fetchNext').mockImplementation(() => {
      query.hasNext = false
    })
    await nextTick()

    intersect(
      [fromPartial<IntersectionObserverEntry>({ isIntersecting: true })],
      fromPartial<IntersectionObserver>({}),
    )
    expect(fetchNext).not.toHaveBeenCalled()
    requireTestElement(
      root.querySelector('[label="Retry loading more"]'),
      HTMLButtonElement,
    ).click()
    await nextTick()
    expect(fetchNext).toHaveBeenCalledOnce()
  })
})

describe('FilesListing selection', () => {
  it('names each row checkbox and derives the header checkbox from the selection', async () => {
    const { root, state } = mount({ rows, selection: ['a'] })
    await nextTick()
    const header = () => root.querySelector('[aria-label="Select all"]')
    const row = (title: string) => root.querySelector(`[aria-label="Select ${title}"]`)

    expect(row('Alpha.png')?.getAttribute('aria-checked')).toBe('true')
    expect(row('Beta.png')?.getAttribute('aria-checked')).toBe('false')
    expect(header()?.getAttribute('aria-checked')).toBe('mixed')

    requireTestElement(root.querySelector('[data-node="b"]'), HTMLElement).click()
    await nextTick()
    expect(state.selection).toEqual(['a', 'b'])
    expect(header()?.getAttribute('aria-checked')).toBe('true')

    requireTestElement(header(), HTMLElement).click()
    await nextTick()
    expect(state.selection).toEqual([])
    expect(header()).toBeNull()
  })
})

describe('FilesListing selected runs', () => {
  it('rounds only the outer corners of adjacent selected rows', async () => {
    const { root } = mount({ rows: [...rows, file('c', 'Gamma.png')], selection: ['a', 'b'] })
    await nextTick()
    const classes = (name: string) => root.querySelector(`[data-node="${name}"]`)!.className

    expect(classes('a')).toContain('sm:!rounded-b-none')
    expect(classes('a')).not.toContain('sm:!rounded-t-none')
    expect(classes('b')).toContain('sm:!rounded-t-none')
    expect(classes('b')).not.toContain('sm:!rounded-b-none')
    expect(classes('c')).not.toContain('!bg-surface-gray-2')
  })
})

describe('FilesListing type column', () => {
  it('names a file by its extension when Drive stored a generic MIME type', async () => {
    const generic = { mime: 'application/octet-stream' }
    const { root } = mount({
      columns: ['kind'],
      rows: [
        file('md', 'Notes.md', generic),
        file('json', 'data.json', generic),
        file('csv', 'report.csv', { mime: 'text/plain' }),
        file('py', 'script.py', generic),
        file('bin', 'firmware.bin', generic),
        file('zip', 'photos.zip', { mime: 'application/zip' }),
        file('png', 'Alpha.png'),
        file('doc', 'Plan', { kind: 'document', mime: null, content_doctype: 'Writer Document' }),
      ],
    })
    await nextTick()
    const icon = (name: string) =>
      root.querySelector(`[data-node="${name}"] [aria-hidden="true"]`)?.className

    expect(['md', 'json', 'csv', 'py', 'bin', 'zip', 'png', 'doc'].map(typeIn(root))).toEqual([
      'Markdown',
      'JSON',
      'CSV',
      'Python',
      'File',
      'ZIP',
      'Image',
      'Document',
    ])
    expect(icon('md')).toContain('file-icon-text')
    expect(icon('json')).toContain('file-icon-code')
    expect(icon('csv')).toContain('file-icon-csv')
    expect(icon('bin')).toContain('file-icon-file')
    expect(icon('zip')).toContain('file-icon-archive')
  })

  const documents = [
    file('sheet', 'Budget', { kind: 'document', mime: null, content_doctype: 'Sheet' }),
    // The older doctype name for a spreadsheet.
    file('old', 'Q1', { kind: 'document', mime: null, content_doctype: 'Spreadsheet' }),
    file('draw', 'Sketch', { kind: 'document', mime: null, content_doctype: 'Drawing' }),
    file('odd', 'Ledger', { kind: 'document', mime: null, content_doctype: 'Ledger Entry' }),
  ]

  it('names documents as the New menu does, and keeps an unknown doctype', async () => {
    const { root } = mount({ columns: ['kind'], rows: documents })
    await nextTick()

    expect(['sheet', 'old', 'draw', 'odd'].map(typeIn(root))).toEqual([
      'Spreadsheet',
      'Spreadsheet',
      'Drawing',
      'Ledger Entry',
    ])
  })

  it('shows the doctype with the tweak off', async () => {
    setTweaks(['t4-type-names'], false)
    const { root } = mount({ columns: ['kind'], rows: documents })
    await nextTick()

    expect(typeIn(root)('sheet')).toBe('Sheet')
  })
})

function typeIn(root: HTMLElement) {
  return (name: string) =>
    root
      .querySelector(`[data-node="${name}"] [data-slot="list-cell"]:nth-child(2)`)
      ?.textContent?.trim()
}

describe('FilesListing grid previews', () => {
  it('falls back to the type icon when a thumbnail fails, and asks for a fresh URL once', async () => {
    const { root, events } = mount({
      view: 'grid',
      rows: [file('a', 'Alpha.png', { preview: { url: '/f/a.webp?s=1', expires: 0 } })],
    })
    await nextTick()
    const img = () => root.querySelector('img')
    expect(img()).not.toBeNull()

    img()!.dispatchEvent(new Event('error'))
    await nextTick()
    expect(img()).toBeNull()
    expect(events.previewErrors).toEqual(['a'])
  })
})

describe('FilesListing loading', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows placeholders only when a load is slow, then the files in their place', async () => {
    vi.useFakeTimers()
    const { root, query } = mount({ rows: [], status: 'pending' })
    await nextTick()
    const placeholders = () =>
      root.querySelectorAll('[data-slot="list-row"][aria-hidden="true"]').length
    expect(placeholders()).toBe(0)
    expect(root.textContent).not.toContain('Empty')

    vi.advanceTimersByTime(200)
    await nextTick()
    expect(placeholders()).toBeGreaterThan(0)

    query.status = 'success'
    query.rows = rows
    await nextTick()
    expect(placeholders()).toBe(0)
    expect(root.querySelector('[data-node="a"]')?.textContent).toContain('Alpha.png')
  })
})

describe('FilesListing keyboard', () => {
  const five = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((title) =>
    file(title.toLowerCase(), `${title}.png`),
  )
  /** Presses a key on whatever has focus, as the browser does. */
  async function press(key: string, init: KeyboardEventInit = {}) {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    )
    await nextTick()
  }
  const focused = () => (document.activeElement as HTMLElement | null)?.dataset.node
  const tabbable = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>('[data-node]')]
      .filter((row) => row.tabIndex === 0)
      .map((row) => row.dataset.node)

  it('moves focus with the arrow keys and selects a range with Shift, which also shrinks it', async () => {
    const { root, state } = mount({ rows: five })
    await nextTick()
    expect(root.querySelector('[role="grid"]')?.getAttribute('aria-multiselectable')).toBe('true')
    expect(tabbable(root)).toEqual(['alpha'])

    root.querySelector<HTMLElement>('[data-node="alpha"]')!.focus()
    await press('ArrowDown')
    expect(focused()).toBe('beta')
    expect(state.selection).toEqual([])
    expect(tabbable(root)).toEqual(['beta'])

    await press('ArrowDown', { shiftKey: true })
    await press('ArrowDown', { shiftKey: true })
    expect(state.selection).toEqual(['beta', 'gamma', 'delta'])
    expect(root.querySelector('[data-node="gamma"]')?.getAttribute('aria-selected')).toBe('true')

    await press('ArrowUp', { shiftKey: true })
    expect(focused()).toBe('gamma')
    expect(state.selection).toEqual(['beta', 'gamma'])

    await press('End')
    expect(focused()).toBe('epsilon')
    await press('Home')
    expect(focused()).toBe('alpha')
    expect(state.selection).toEqual(['beta', 'gamma'])

    await press(' ')
    expect(state.selection).toEqual(['beta', 'gamma', 'alpha'])
  })

  it('jumps to the next item whose name starts with what was typed', async () => {
    const { root } = mount({ rows: five })
    await nextTick()
    root.querySelector<HTMLElement>('[data-node="alpha"]')!.focus()

    await press('d')
    expect(focused()).toBe('delta')
    await press('E', { shiftKey: true })
    expect(focused()).toBe('delta')
  })

  it('hands focus to the next item when the focused one leaves', async () => {
    const { root, query } = mount({ rows: [...five] })
    await nextTick()
    root.querySelector<HTMLElement>('[data-node="gamma"]')!.focus()
    await nextTick()

    query.rows = query.rows.filter((row) => row.name !== 'gamma')
    await nextTick()
    await nextTick()

    expect(focused()).toBe('delta')
    expect(tabbable(root)).toEqual(['delta'])
  })

  it('selects a card with Space in grid view, without opening it', async () => {
    const { root, state, events } = mount({ rows: five, view: 'grid' })
    await nextTick()
    const card = root.querySelector<HTMLElement>('[data-node="beta"]')!
    card.focus()

    await press(' ')

    expect(state.selection).toEqual(['beta'])
    expect(events.opened).toEqual([])
  })

  it('keeps every row a Tab stop and the arrow keys still, with the tweaks off', async () => {
    setTweaks(['t13-arrow-keys', 't13-type-ahead'], false)
    const { root } = mount({ rows: five })
    await nextTick()
    expect(root.querySelector('[role="grid"]')).toBeNull()
    expect(tabbable(root)).toHaveLength(5)

    root.querySelector<HTMLElement>('[data-node="alpha"]')!.focus()
    await press('ArrowDown')
    await press('d')
    expect(focused()).toBe('alpha')
  })
})
