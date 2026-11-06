import { createPinia, getActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, type App } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { drivePaletteSearch } from '@/apps/drive'
import { PALETTE_SEARCH_KEY } from '@/platform/contracts'
import { setTweaks } from '@/platform/tweaks'
import SuiteCommandPalette from '@/shell/SuiteCommandPalette.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../node_modules/frappe-ui/src/components/KeyboardShortcut')),
  ...(await import('../../../node_modules/frappe-ui/src/components/Tooltip')),
  ...(await import('../../../node_modules/frappe-ui/src/composables/useKeyboardShortcut')),
  toast: { success: () => {}, error: () => {}, warning: () => {}, info: () => {} },
}))

// The HTTP boundary, stubbed before the transport captures `fetch`. Drive's search finds a
// document and a folder, both at the top of My files.
const net = vi.hoisted(() => {
  const personalRoot = 'personal-root'
  const searches: string[] = []
  const driveNode = (name: string, title: string, kind: string, contentDoctype: string | null) => ({
    name,
    title,
    kind,
    parent_node: personalRoot,
    root: personalRoot,
    state: 'Active',
    trash_root: null,
    size: 0,
    mime: null,
    url: null,
    content_doctype: contentDoctype,
    content_docname: contentDoctype ? `${name}-content` : null,
    is_template: 0,
    owner: { id: 'me@example.com', full_name: 'Me', user_image: null },
    creation: null,
    modified: null,
    content_modified: null,
    breadcrumbs: [{ name: personalRoot, title: 'Aanya', kind: 'folder', role: 50 }],
  })
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(status === 200 ? { data } : data), { status })
  globalThis.fetch = async (url: RequestInfo | URL) => {
    const address = new URL(String(url), 'http://suite.test')
    const path = address.pathname.replace('/api/suite/drive/', '')
    if (path === 'roots')
      return json({ personal: { node: personalRoot, title: 'Aanya' }, organization: null })
    if (path === 'views/search') {
      searches.push(address.searchParams.get('term') ?? '')
      return json({
        rows: [
          driveNode('plan-doc', 'Quarterly plan', 'document', 'Writer Document'),
          driveNode('plan-folder', 'Plans', 'folder', null),
        ],
        next_cursor: null,
      })
    }
    return json({ errors: [{ type: 'NotFound', message: path }] }, 404)
  }
  return { searches }
})

beforeEach(() => {
  net.searches.length = 0
  // jsdom lays nothing out, so the list's highlight has nothing to scroll.
  Element.prototype.scrollIntoView = () => {}
})

const mounted: App[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  document.body.replaceChildren()
})

async function mountPalette(path: string): Promise<Router> {
  const page = { render: () => h('main') }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/mail', component: page, meta: { area: 'mail' } },
      { path: '/people', component: page, meta: { area: 'people' } },
      { path: '/d/:node/:slug?', component: page },
      { path: '/drive/f/:node/:slug?', component: page, meta: { area: 'files' } },
    ],
  })
  await router.push(path)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(SuiteCommandPalette, { areas: [] }) })
  app.use(createPinia())
  app.use(router)
  app.provide(PALETTE_SEARCH_KEY, drivePaletteSearch)
  app.mount(host)
  mounted.push(app)
  return router
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
}

const paletteInput = () => document.querySelector<HTMLInputElement>('[role="dialog"] input')

async function openPalette() {
  press(document.body, 'k', { ctrlKey: true })
  await vi.waitFor(() => expect(paletteInput()).not.toBeNull())
  return paletteInput()!
}

/** Types into the palette and waits for Drive's answer. Returns the rows, top to bottom. */
async function search(input: HTMLInputElement, term: string) {
  input.value = term
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const dialog = document.querySelector('[role="dialog"]')!
  await vi.waitFor(() => expect(dialog.textContent).toContain('Quarterly plan'))
  return [...dialog.querySelectorAll('[data-slot="command-palette-item"]')]
}

const rowText = (row: Element) => ({
  name: row.querySelector('[data-slot="command-palette-item-label"]')?.textContent?.trim(),
  folder: row.lastElementChild?.textContent?.trim(),
})

describe('Suite command palette', () => {
  it('opens on Cmd+K on a Mail page, also while typing in a field there', async () => {
    await mountPalette('/mail')
    const field = document.body.appendChild(document.createElement('input'))
    field.focus()
    press(field, 'k', { ctrlKey: true })
    await vi.waitFor(() => expect(paletteInput()).not.toBeNull())
  })

  it('finds Drive items by name from a page with no search of its own, and opens one with Enter', async () => {
    const router = await mountPalette('/people')
    const input = await openPalette()
    expect(input.placeholder).toBe('Search in Drive')

    const rows = await search(input, 'plan')
    expect(net.searches).toEqual(['plan'])
    expect(rows.map(rowText)).toEqual([
      { name: 'Quarterly plan', folder: 'My files' },
      { name: 'Plans', folder: 'My files' },
    ])
    expect(rows[0].querySelector('.file-icon-doc')).not.toBeNull()
    expect(rows[1].querySelector('.file-icon-folder')).not.toBeNull()

    await vi.waitFor(() => expect(rows[0].getAttribute('data-state')).toBe('active'))
    press(input, 'Enter')
    await vi.waitFor(() =>
      expect(router.currentRoute.value.path).toBe('/d/plan-doc/quarterly-plan'),
    )
  })

  it('does not load the mail account on a Drive page', async () => {
    await mountPalette('/drive/f/plans')
    expect(Object.keys(getActivePinia()!.state.value)).not.toContain('mail-user')

    setTweaks(['t24-palette-no-mail'], false)
    await mountPalette('/drive/f/plans')
    expect(Object.keys(getActivePinia()!.state.value)).toContain('mail-user')
    setTweaks(['t24-palette-no-mail'], true)
  })

  it('keeps matching commands above the Drive results', async () => {
    await mountPalette('/people')
    const rows = await search(await openPalette(), 'settings')
    expect(rows.map((row) => rowText(row).name)).toEqual(['Settings', 'Quarterly plan', 'Plans'])
    const labels = document.querySelectorAll('[role="dialog"] [role="group"]')
    expect([...labels].map((group) => group.firstElementChild?.textContent?.trim())).toEqual([
      'Suggested',
      'Drive',
    ])
  })
})
