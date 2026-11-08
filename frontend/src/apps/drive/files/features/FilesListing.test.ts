import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, watch } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'
import { DOCUMENT_TYPES_KEY, type DocumentTypeDefinition } from '@/platform/contracts'
import { requireTestElement } from '@/platform/testing/dom'

import FilesListing from './FilesListing.vue'
import { DEFAULT_PRESENTATION, type FilesColumn, type PresentationState } from './presentation'
import { useDragMove } from './useDragMove'
import { useListingSelection } from './useListingSelection'

// Drive, for the move preview a drop asks for: nobody gains access, so the move goes ahead without asking.
vi.hoisted(() => {
  globalThis.fetch = async () =>
    Response.json({ data: { gains: [], role_now: 40, role_after: 40 } })
})

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
  columns?: FilesColumn[]
  selection?: string[]
  status?: 'pending' | 'success' | 'error'
  /** Drag to move, as a folder page sets it up. Moves are recorded, not sent. */
  drag?: boolean
  canShare?: (node: DriveNode) => boolean
  nodeHref?: (node: DriveNode) => string | undefined
}) {
  const state = reactive({ selection: options.selection ?? [] })
  type ListingEvents = {
    previewErrors: string[]
    opened: string[]
    shared: string[]
    moved: { items: string[]; to: string }[]
  }
  const events: ListingEvents = { previewErrors: [], opened: [], shared: [], moved: [] }
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
      const drag = options.drag
        ? useDragMove({
            enabled: () => true,
            rows: () => query.rows,
            selection: () => picked.selected.value,
            folder: () => null,
            roots: () => null,
            move: async ({ items }, folder) => {
              events.moved.push({ items: items.map((item) => item.name), to: folder.node })
            },
            trash: async () => {},
          })
        : undefined
      return () =>
        h(FilesListing, {
          query: fromPartial<InstanceType<typeof FilesListing>['$props']['query']>(query),
          presentation: {
            ...DEFAULT_PRESENTATION,
            view: options.view ?? 'list',
            columns: options.columns ?? ['owner', 'modified'],
          },
          selection: picked.selected.value,
          selectionMode: picked.selectionMode.value,
          emptyTitle: 'Empty',
          emptyDescription: '',
          menuOptions: () => [],
          drag,
          canShare: options.canShare,
          nodeHref: options.nodeHref,
          onShare: (node: DriveNode) => {
            events.shared.push(node.name)
          },
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

  it('ends the walk quietly when a new search or place cancels the window it loads', async () => {
    const { query } = mount({ rows })
    const fetchNext = vi.spyOn(query, 'fetchNext').mockImplementation(async () => {
      query.hasNext = false
      throw new DOMException('Aborted', 'AbortError')
    })
    query.hasNext = true
    await nextTick()

    // An uncaught rejection here fails the run.
    intersect(
      [fromPartial<IntersectionObserverEntry>({ isIntersecting: true })],
      fromPartial<IntersectionObserver>({}),
    )
    await vi.waitFor(() => expect(fetchNext).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve))
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

describe('FilesListing checkboxes with a mouse', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(hover: hover) and (pointer: fine)',
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }))
  })
  const checkbox = (root: HTMLElement, title: string) =>
    root.querySelector<HTMLElement>(`[aria-label="Select ${title}"]`)

  it('selects a row from its checkbox without opening it, with Select all always there', async () => {
    const { root, state, events } = mount({ rows })
    await nextTick()
    expect(root.querySelector('[aria-label="Select all"]')).not.toBeNull()

    checkbox(root, 'Beta.png')!.click()
    await nextTick()

    expect(state.selection).toEqual(['b'])
    expect(events.opened).toEqual([])
  })

  it('gives a card a labelled checkbox beside its button, which selects without opening', async () => {
    const { root, state, events } = mount({ rows, view: 'grid' })
    await nextTick()
    const box = checkbox(root, 'Alpha.png')!
    expect(box.closest('button')).toBeNull()

    box.click()
    await nextTick()

    expect(state.selection).toEqual(['a'])
    expect(events.opened).toEqual([])
    expect(checkbox(root, 'Alpha.png')?.getAttribute('aria-checked')).toBe('true')
  })

  it('puts a card’s checkbox in its type icon’s place, with no tile behind it', async () => {
    const { root } = mount({ rows, view: 'grid', selection: ['a'] })
    await nextTick()
    const typeIcon = root.querySelector('[data-listing-item="b"] button > span > span')!

    expect(typeIcon.classList).toContain('invisible')
    expect(checkbox(root, 'Beta.png')!.className).not.toMatch(/\bbg-|shadow/)
  })
})

describe('FilesListing columns', () => {
  it('sizes each column by its place in the row, whatever order they were chosen in', async () => {
    const { root } = mount({ rows, columns: ['size', 'modified', 'owner'] })
    await nextTick()
    const list = root.querySelector<HTMLElement>('[style*="--_list-columns-md"]')!

    // Name, Owner (at its widest until its labels are measured), Size, Modified, then the menu.
    expect(list.style.getPropertyValue('--_list-columns-md')).toBe(
      'minmax(0,1fr) 160px 72px 96px 2.5rem',
    )
  })

  describe('sized to their labels', () => {
    beforeEach(() => {
      // Text 7 px a character wide, as the ruler measures it.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        return fromPartial<DOMRect>({ width: (this.textContent?.length ?? 0) * 7 })
      })
    })
    afterEach(() => vi.restoreAllMocks())
    const labelled = [
      file('a', 'Alpha.png'),
      file('s', 'Plan', {
        kind: 'document',
        content_doctype: 'Sheet',
        owner: { id: 'leo@example.com', full_name: 'Leo Fernandes', user_image: null },
      }),
    ]

    it('fits Type to its longest name and Owner to its longest name beside the avatar', async () => {
      const { root } = mount({ rows: labelled, columns: ['kind', 'owner', 'size', 'modified'] })
      await nextTick()
      await nextTick()
      const list = root.querySelector<HTMLElement>('[style*="--_list-columns-md"]')!

      // "Spreadsheet" is 77 px; "Leo Fernandes" is 91 px, and the avatar and its gap 24.
      expect(list.style.getPropertyValue('--_list-columns-md')).toBe(
        'minmax(0,1fr) 77px 115px 72px 96px 2.5rem',
      )
      expect(list.classList).toContain('md:list-gap-6')
    })
  })

  describe('in a narrow list', () => {
    let listWidth: number
    beforeEach(() => {
      listWidth = 620
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(private callback: ResizeObserverCallback) {}
          observe() {
            const entry = fromPartial<ResizeObserverEntry>({ contentRect: { width: listWidth } })
            this.callback([entry], fromPartial<ResizeObserver>(this))
          }
          disconnect() {}
        },
      )
    })
    const header = (root: HTMLElement, label: string) =>
      [...root.querySelectorAll('[role="columnheader"]')].find((cell) =>
        cell.textContent?.includes(label),
      )

    it('hides the columns that leave Name too little room on a desktop, and keeps Size on a phone', async () => {
      const { root } = mount({ rows, columns: ['access', 'kind', 'size', 'modified'] })
      await nextTick()
      const list = root.querySelector<HTMLElement>('[style*="--_list-columns-md"]')!

      // 620 px holds Name at 240 px beside Access and Modified, with 24 px gaps, not Type or Size.
      expect(list.style.getPropertyValue('--_list-columns-md')).toBe(
        'minmax(0,1fr) 160px 96px 2.5rem',
      )
      expect(list.style.getPropertyValue('--_list-columns-base')).toBe('minmax(0,1fr) 72px 2.5rem')
      expect(header(root, 'Type')?.classList).toContain('hidden')
      expect(header(root, 'Type')?.classList).not.toContain('md:flex')
      expect(header(root, 'Size')?.classList).toContain('md:hidden')
      expect(header(root, 'Access')?.classList).toContain('md:flex')
    })
  })
})

describe('FilesListing name links', () => {
  const nodeHref = (node: DriveNode) => `/d/${node.name}`
  const press = (target: Element, init: MouseEventInit = {}) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }

  for (const view of ['list', 'grid'] as const) {
    it(`links each name in ${view} view without a Tab stop or a native drag`, async () => {
      const { root } = mount({ rows, view, nodeHref })
      await nextTick()
      const link = root.querySelector<HTMLAnchorElement>('[data-listing-item="a"] a[href]')!

      expect(link.getAttribute('href')).toBe('/d/a')
      expect(link.textContent).toBe('Alpha.png')
      expect(link.tabIndex).toBe(-1)
      expect(link.getAttribute('draggable')).toBe('false')
    })

    it(`leaves Cmd/Ctrl-click to the link and keeps plain and Shift clicks in ${view} view`, async () => {
      const { root, state, events } = mount({ rows, view, nodeHref })
      await nextTick()
      const link = (name: string) =>
        root.querySelector<HTMLAnchorElement>(`[data-listing-item="${name}"] a[href]`)!

      // The browser opens the link in a new tab; the listing does nothing.
      expect(press(link('a'), { ctrlKey: true }).defaultPrevented).toBe(false)
      expect(state.selection).toEqual([])
      expect(events.opened).toEqual([])

      // A plain click opens in place, without following the link.
      expect(press(link('a')).defaultPrevented).toBe(true)
      expect(events.opened).toEqual(['a'])

      press(link('a'), { shiftKey: true })
      await nextTick()
      expect(state.selection).toEqual(['a'])
    })
  }

  describe('look', () => {
    const looksLikeLink = (link: Element) => link.hasAttribute('data-new-tab')
    const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit) =>
      window.dispatchEvent(new KeyboardEvent(type, init))
    afterEach(() => {
      vi.restoreAllMocks()
    })

    for (const [platform, held, other] of [
      ['Linux x86_64', { key: 'Control', ctrlKey: true }, { key: 'Meta', metaKey: true }],
      ['MacIntel', { key: 'Meta', metaKey: true }, { key: 'Control', ctrlKey: true }],
    ] as const) {
      it(`leaves a click with ${held.key} to the link, and only that key, on ${platform}`, async () => {
        vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
        const { root } = mount({ rows, nodeHref })
        await nextTick()
        const link = root.querySelector('[data-listing-item="a"] a[href]')!
        const pressed = (metaKey: boolean, ctrlKey: boolean) =>
          press(link, { metaKey, ctrlKey }).defaultPrevented

        expect(pressed(held.key === 'Meta', held.key === 'Control')).toBe(false)
        expect(pressed(other.key === 'Meta', other.key === 'Control')).toBe(true)
      })

      it(`looks like a link only while the pointer is on it and ${held.key} is held, on ${platform}`, async () => {
        vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
        const { root } = mount({ rows, nodeHref })
        await nextTick()
        const link = root.querySelector('[data-listing-item="a"] a[href]')!

        // Holding the key away from the name changes nothing.
        key('keydown', held)
        expect(looksLikeLink(link)).toBe(false)

        // Hovering with the key already held shows it at once.
        const modifiers = { ctrlKey: held.key === 'Control', metaKey: held.key === 'Meta' }
        link.dispatchEvent(new MouseEvent('pointerenter', modifiers))
        expect(looksLikeLink(link)).toBe(true)

        // Releasing it, with the pointer still, restores the plain look.
        key('keyup', { key: held.key })
        expect(looksLikeLink(link)).toBe(false)
        key('keydown', other)
        expect(looksLikeLink(link)).toBe(false)
        key('keydown', held)
        expect(looksLikeLink(link)).toBe(true)

        // The window losing focus, as a new tab opens, drops the look.
        window.dispatchEvent(new Event('blur'))
        expect(looksLikeLink(link)).toBe(false)

        key('keydown', held)
        link.dispatchEvent(new MouseEvent('pointerleave'))
        expect(looksLikeLink(link)).toBe(false)
        key('keydown', held)
        expect(looksLikeLink(link)).toBe(false)
      })
    }

    it('follows only the name under the pointer', async () => {
      const { root } = mount({ rows, view: 'grid', nodeHref })
      await nextTick()
      const [first, second] = root.querySelectorAll('a[href]')

      first!.dispatchEvent(new MouseEvent('pointerenter', { ctrlKey: true }))
      second!.dispatchEvent(new MouseEvent('pointerenter', { ctrlKey: true }))

      expect([looksLikeLink(first!), looksLikeLink(second!)]).toEqual([false, true])
    })
  })

  it('keeps plain text without an address', async () => {
    const { root } = mount({ rows })
    await nextTick()

    expect(root.querySelector('a[href]')).toBeNull()
  })
})

describe('FilesListing access column', () => {
  afterEach(() => {
    delete window.suite_workspace_name
  })
  const shared = (name: string, kind: 'public' | 'organization' | 'link' | 'people', people = 1) =>
    file(name, `${name}.png`, { audience: { kind, people } })
  const audienceRows = [
    shared('mine', 'people'),
    shared('three', 'people', 3),
    shared('org', 'organization', 5),
    shared('link', 'link', 2),
    shared('public', 'public', 2),
  ]
  const accessOf = (root: HTMLElement, name: string) =>
    root.querySelector(`[data-node="${name}"]`)?.textContent ?? ''

  it('says how widely each item is shared, after the name, and names nobody', async () => {
    window.suite_workspace_name = 'Northwind Labs'
    const { root } = mount({ rows: audienceRows, columns: ['access', 'modified'] })
    await nextTick()

    expect(accessOf(root, 'mine')).toContain('Only you')
    expect(accessOf(root, 'three')).toContain('3 people')
    expect(accessOf(root, 'org')).toContain('Northwind Labs')
    expect(accessOf(root, 'link')).toContain('Anyone with the link')
    expect(accessOf(root, 'public')).toContain('Public')
    const list = root.querySelector<HTMLElement>('[style*="--_list-columns-md"]')!
    expect(list.style.getPropertyValue('--_list-columns-md')).toBe(
      'minmax(0,1fr) 160px 96px 2.5rem',
    )
  })

  it('opens Share from the cell where the user may share, and the row elsewhere', async () => {
    const { root, events } = mount({
      rows: audienceRows,
      columns: ['access'],
      canShare: (node) => node.name !== 'org',
    })
    await nextTick()
    const words = (text: string) =>
      [...root.querySelectorAll<HTMLElement>('span')].find((span) => span.textContent === text)!

    words('3 people').click()
    words('Your organization').click()

    expect(events.shared).toEqual(['three'])
    expect(events.opened).toEqual(['org'])
  })

  it('opens only Share on a double click on the cell, and the item where the user may not share', async () => {
    const { root, events } = mount({
      rows: audienceRows,
      columns: ['access'],
      canShare: (node) => node.name !== 'org',
    })
    await nextTick()
    const doubleClick = (text: string) => {
      const words = [...root.querySelectorAll<HTMLElement>('span')].find(
        (span) => span.textContent === text,
      )!
      words.click()
      words.click()
      words.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))
    }

    doubleClick('3 people')
    expect(events.opened).toEqual([])
    expect(events.shared).toContain('three')

    doubleClick('Your organization')
    expect(events.opened).toContain('org')
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
})

describe('FilesListing size column', () => {
  it('shows a folder’s total when the listing read one, and nothing for an empty folder', async () => {
    const folder = { kind: 'folder', mime: null, size: 0 }
    const { root } = mount({
      columns: ['size'],
      rows: [
        file('full', 'Projects', { ...folder, contents_size: 3_451_500 }),
        file('empty', 'Empty', { ...folder, contents_size: 0 }),
        // A listing that did not ask, such as Trash, has no total.
        file('unread', 'Archive', folder),
        file('png', 'Alpha.png', { size: 1_536 }),
      ],
    })
    await nextTick()

    expect(['full', 'empty', 'unread', 'png'].map(typeIn(root))).toEqual([
      '3.3 MB',
      '',
      '',
      '1.5 KB',
    ])
  })
})

/** The text of the first column after the name. */
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
  afterEach(() => vi.useRealTimers())

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

  const placeholders = (root: HTMLElement) =>
    root.querySelectorAll('[data-slot="list-row"][aria-hidden="true"]').length
  const emptyState = (root: HTMLElement) =>
    [...root.querySelectorAll('p')].find((p) => p.textContent === 'Empty')?.parentElement

  it('stays blank for 200 ms, and fades the empty state in after a load', async () => {
    vi.useFakeTimers()
    const { root, query } = mount({ rows: [], status: 'pending' })
    await nextTick()

    vi.advanceTimersByTime(190)
    await nextTick()
    expect(placeholders(root)).toBe(0)

    query.status = 'success'
    await nextTick()
    expect(placeholders(root)).toBe(0)
    expect(emptyState(root)?.className).toContain('animate-')
  })

  it('shows an empty folder the cache already knew at once, without a fade', async () => {
    const { root } = mount({ rows: [], status: 'success' })
    await nextTick()

    expect(emptyState(root)?.className).not.toContain('animate-')
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
  const focused = () =>
    document.activeElement instanceof HTMLElement ? document.activeElement.dataset.node : undefined
  const tabbable = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>('[data-node]')].flatMap((row) =>
      row.tabIndex === 0 ? [row.dataset.node] : [],
    )

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

  it('opens with Enter, and leaves Mod+Enter to the new-tab shortcut', async () => {
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      const { root, events } = mount({ rows: five })
      await nextTick()
      root.querySelector<HTMLElement>('[data-node="beta"]')!.focus()

      await press('Enter', modifier)
      expect(events.opened).toEqual([])

      await press('Enter')
      expect(events.opened).toEqual(['beta'])
      cleanup?.()
      cleanup = undefined
    }
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
})

describe('FilesListing drag to move', () => {
  let frames: FrameRequestCallback[] = []
  let underPointer: Element | null = null
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(hover: hover) and (pointer: fine)',
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    )
    vi.stubGlobal('cancelAnimationFrame', () => {})
    document.elementFromPoint = () => underPointer
    window.suite_workspace_name = 'Northwind'
  })
  afterEach(() => {
    frames = []
    underPointer = null
  })
  /** Runs the frames the drag asked for, once each. */
  function nextFrame() {
    const due = frames
    frames = []
    for (const callback of due) callback(0)
  }
  function pointer(type: string, target: EventTarget, x: number) {
    const init = { bubbles: true, pointerType: 'mouse', button: 0, clientX: x, clientY: 0 }
    target.dispatchEvent(new PointerEvent(type, init))
  }

  it('moves a row dragged by its name onto a folder row, while a drag from elsewhere on a row still selects', async () => {
    const editable = { access: { role: 40 } }
    const rows = [
      file('f', 'Reports', { kind: 'folder', access: { role: 30 } }),
      file('a', 'Alpha.png', editable),
      file('b', 'Beta.png', editable),
    ]
    const { root, events } = mount({ rows, drag: true })
    await nextTick()
    const name = [...root.querySelectorAll('[data-drag-handle]')].find(
      (element) => element.textContent === 'Alpha.png',
    )!
    underPointer = root.querySelector('[data-node="f"]')

    pointer('pointerdown', name, 0)
    pointer('pointermove', window, 30)
    nextFrame()
    await nextTick()
    expect(document.body.textContent).toContain('Move to Reports')
    expect(root.querySelector('.bg-surface-blue-2\\/50')).toBeNull()

    pointer('pointerup', window, 30)
    await vi.waitFor(() => expect(events.moved).toEqual([{ items: ['a'], to: 'f' }]))
    expect(document.body.textContent).not.toContain('Move to Reports')

    // The Beta row outside its name draws the marquee, and moves nothing.
    pointer('pointerdown', root.querySelector('[data-node="b"]')!, 0)
    pointer('pointermove', window, 30)
    nextFrame()
    await nextTick()
    expect(root.querySelector('.bg-surface-blue-2\\/50')).not.toBeNull()
    pointer('pointerup', window, 30)
    expect(events.moved).toHaveLength(1)
  })
})
