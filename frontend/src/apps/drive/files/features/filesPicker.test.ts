import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import FilesPicker from './FilesPicker.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Breadcrumbs')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Checkbox')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/ErrorMessage')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Skeleton')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/TabButtons')),
}))

// My files holds Invoice.pdf, a Notes document and the Projects folder, which holds Plan.xlsx.
vi.hoisted(() => {
  const node = (name: string, title: string, kind: string, parent: string | null, size = 0) => ({
    name,
    title,
    kind,
    parent_node: parent,
    root: 'mine',
    state: 'Active',
    trash_root: null,
    size,
    mime: null,
    url: null,
    content_doctype: kind === 'document' ? 'Writer Document' : null,
    content_docname: null,
    is_template: 0,
    owner: { id: 'me@example.com', full_name: 'Me', user_image: null },
    creation: null,
    modified: null,
    content_modified: null,
    access: { role: 50 },
    breadcrumbs: [],
  })
  const nodes = [
    node('mine', 'Aanya', 'folder', null),
    node('invoice', 'Invoice.pdf', 'file', 'mine', 2048),
    node('notes', 'Notes', 'document', 'mine'),
    node('projects', 'Projects', 'folder', 'mine'),
    node('plan', 'Plan.xlsx', 'file', 'projects', 4096),
  ]
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(status === 200 ? { data } : data), { status })
  globalThis.fetch = async (url: RequestInfo | URL) => {
    const path = new URL(String(url), 'http://drive.test').pathname.replace('/api/suite/drive/', '')
    if (path === 'roots')
      return json({ personal: { node: 'mine', title: 'Aanya' }, organization: null })
    const [, parent] = path.match(/^nodes\/([^/]+)\/children$/) ?? []
    if (parent)
      return json({ rows: nodes.filter((row) => row.parent_node === parent), next_cursor: null })
    return json({ errors: [{ type: 'NotFound', message: path }] }, 404)
  }
})

describe('Files picker', () => {
  let cleanup: (() => void) | undefined
  afterEach(() => cleanup?.())

  function mount() {
    const onPicked = vi.fn()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp({
      setup: () => () => h(FilesPicker, { open: true, action: 'Attach', onPicked }),
    })
    app.mount(root)
    cleanup = () => {
      app.unmount()
      root.remove()
    }
    return onPicked
  }
  const row = (title: string) =>
    vi.waitFor(() => {
      const found = [...document.querySelectorAll('li button')].find((candidate) =>
        candidate.textContent?.includes(title),
      )
      if (!(found instanceof HTMLButtonElement)) throw new Error(`${title} is not listed`)
      return found
    })
  const attach = () =>
    [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === 'Attach',
    ) as HTMLButtonElement

  it('keeps files picked in one folder while the user picks in another', async () => {
    const onPicked = mount()

    const invoice = await row('Invoice.pdf')
    expect(attach().disabled).toBe(true)
    invoice.click()
    ;(await row('Projects')).click()
    ;(await row('Plan.xlsx')).click()
    await vi.waitFor(() => expect(attach().disabled).toBe(false))
    attach().click()

    expect(onPicked).toHaveBeenCalledWith([
      { node: 'invoice', title: 'Invoice.pdf', size: 2048 },
      { node: 'plan', title: 'Plan.xlsx', size: 4096 },
    ])
  })

  it('shows a document but does not let it be picked, since only files can be copied', async () => {
    mount()

    expect((await row('Notes')).disabled).toBe(true)
    expect((await row('Invoice.pdf')).disabled).toBe(false)
  })

  it('takes a file back out when it is picked a second time', async () => {
    const onPicked = mount()

    const invoice = await row('Invoice.pdf')
    invoice.click()
    await vi.waitFor(() => expect(invoice.getAttribute('aria-pressed')).toBe('true'))
    invoice.click()
    await vi.waitFor(() => expect(invoice.getAttribute('aria-pressed')).toBe('false'))

    expect(attach().disabled).toBe(true)
    expect(onPicked).not.toHaveBeenCalled()
  })
})
