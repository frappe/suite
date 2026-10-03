import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'

import FilesListing from './FilesListing.vue'
import { DEFAULT_PRESENTATION, type PresentationState } from './presentation'

let cleanup: (() => void) | undefined
beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup?.()
  vi.unstubAllGlobals()
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
  status?: string
}) {
  const state = reactive({ selection: options.selection ?? [] })
  const events: { previewErrors: string[] } = { previewErrors: [] }
  const query = reactive({
    status: options.status ?? 'success',
    rows: options.rows,
    error: null,
    hasNext: false,
    isFetchingNext: false,
    refetch() {},
    fetchNext() {},
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({
    setup: () => () =>
      h(FilesListing, {
        query: query as never,
        presentation: {
          ...DEFAULT_PRESENTATION,
          view: options.view ?? 'list',
          columns: options.columns ?? DEFAULT_PRESENTATION.columns,
        },
        selection: state.selection,
        selectionMode: state.selection.length > 0,
        emptyTitle: 'Empty',
        emptyDescription: '',
        menuOptions: () => [],
        'onUpdate:selection': (value: string[]) => {
          state.selection = value
        },
        onSelect: (node: DriveNode) => {
          state.selection = state.selection.includes(node.name)
            ? state.selection.filter((name) => name !== node.name)
            : [...state.selection, node.name]
        },
        onPreviewError: (node: DriveNode) => {
          events.previewErrors.push(node.name)
        },
      }),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return { root, state, events, query }
}

const rows = [file('a', 'Alpha.png'), file('b', 'Beta.png')]

describe('FilesListing selection', () => {
  it('names each row checkbox and derives the header checkbox from the selection', async () => {
    const { root, state } = mount({ rows, selection: ['a'] })
    await nextTick()
    const header = () => root.querySelector('[aria-label="Select all"]')
    const row = (title: string) => root.querySelector(`[aria-label="Select ${title}"]`)

    expect(row('Alpha.png')?.getAttribute('aria-checked')).toBe('true')
    expect(row('Beta.png')?.getAttribute('aria-checked')).toBe('false')
    expect(header()?.getAttribute('aria-checked')).toBe('mixed')

    ;(root.querySelector('[data-node="b"]') as HTMLElement).click()
    await nextTick()
    expect(state.selection).toEqual(['a', 'b'])
    expect(header()?.getAttribute('aria-checked')).toBe('true')

    ;(header() as HTMLElement).click()
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
    const type = (name: string) =>
      root
        .querySelector(`[data-node="${name}"] [data-slot="list-cell"]:nth-child(2)`)
        ?.textContent?.trim()
    const icon = (name: string) =>
      root.querySelector(`[data-node="${name}"] [aria-hidden="true"]`)?.className

    expect(['md', 'json', 'csv', 'py', 'bin', 'zip', 'png', 'doc'].map(type)).toEqual([
      'Markdown',
      'JSON',
      'CSV',
      'Python',
      'File',
      'ZIP',
      'Image',
      'Writer Document',
    ])
    expect(icon('md')).toContain('lucide-file-text')
    expect(icon('json')).toContain('lucide-file-code')
    expect(icon('bin')).toContain('lucide-file ')
  })
})

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
