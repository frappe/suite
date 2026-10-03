import { afterEach, describe, expect, it, vi } from 'vitest'

import { announceCopy, announceMove, announceRestore, announceTrash } from './changeToast'

// A Drive server that records each move and keeps every node's parent.
const net = vi.hoisted(() => {
  const state = {
    parents: new Map<string, string>(),
    requests: [] as Array<{ method: string; path: string; body: unknown }>,
    /** The folder the server refuses to move items into, with its message. */
    refuse: null as { parent: string; message: string } | null,
    /** Each node's state, as a trash or restore left it. */
    states: new Map<string, string>(),
    /** A node the server refuses to restore, with its message. */
    refuseRestore: null as { node: string; message: string } | null,
  }
  const node = (name: string) => ({
    name,
    title: name,
    kind: 'file',
    parent_node: state.parents.get(name) ?? null,
    root: 'root',
    state: 'Active',
    trash_root: null,
    size: 1,
    mime: 'text/plain',
    url: null,
    content_doctype: null,
    content_docname: null,
    is_template: 0,
    owner: { id: 'Administrator', full_name: 'Administrator', user_image: null },
    creation: null,
    modified: `m-${state.requests.length}`,
    content_modified: null,
  })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  globalThis.fetch = async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(url), 'http://drive.test').pathname.replace('/api/suite/drive/', '')
    const body = init.body ? JSON.parse(String(init.body)) : null
    state.requests.push({ method: init.method ?? 'GET', path, body })
    // A move that names the folder it expects the node in is refused once the node moved on (Drive spec §8.2).
    const movedOn = (name: string, expected: string | undefined) =>
      expected !== undefined && state.parents.get(name) !== expected
    if (init.method === 'PATCH' && path.startsWith('nodes/')) {
      const name = decodeURIComponent(path.slice('nodes/'.length))
      const refuse = state.refuse
      if (refuse && refuse.parent === body.parent_node) {
        return json({ errors: [{ type: 'DriveConflict', message: refuse.message }] }, 409)
      }
      if (movedOn(name, body.expect_parent_node)) {
        return json(
          { errors: [{ type: 'DriveMoved', message: `${name} has moved since you last saw it` }] },
          409,
        )
      }
      state.parents.set(name, body.parent_node)
      return json({ data: node(name) })
    }
    if (init.method === 'POST' && path === 'nodes/batch' && body.patch.state) {
      const { nodes, patch } = body as { nodes: string[]; patch: { state: string } }
      const refused = patch.state === 'Active' ? state.refuseRestore : null
      const failed = refused ? nodes.filter((name) => name === refused.node) : []
      for (const name of nodes) if (!failed.includes(name)) state.states.set(name, patch.state)
      return json({
        data: {
          ok: nodes.filter((name) => !failed.includes(name)),
          failed: failed.map((name) => ({
            node: name,
            type: 'DriveConflict',
            message: refused!.message,
          })),
        },
      })
    }
    if (init.method === 'POST' && path === 'nodes/batch') {
      const { nodes, patch } = body as {
        nodes: string[]
        patch: { parent_node: string; expect_parent_node?: string }
      }
      const refuse = state.refuse
      if (refuse && refuse.parent === patch.parent_node) {
        return json({
          data: {
            ok: [],
            failed: nodes.map((name) => ({
              node: name,
              type: 'DriveConflict',
              message: refuse.message,
            })),
          },
        })
      }
      const failed = nodes.filter((name) => movedOn(name, patch.expect_parent_node))
      for (const name of nodes)
        if (!failed.includes(name)) state.parents.set(name, patch.parent_node)
      return json({
        data: {
          ok: nodes.filter((name) => !failed.includes(name)),
          failed: failed.map((name) => ({
            node: name,
            type: 'DriveMoved',
            message: `${name} has moved since you last saw it`,
          })),
        },
      })
    }
    return json({ errors: [{ type: 'NotFound', message: path }] }, 404)
  }
  return state
})

interface ShownToast {
  kind: 'success' | 'error'
  message: string
  description?: string
  action?: { label: string; onClick: () => void }
}
const feedback = vi.hoisted(() => ({ toasts: [] as ShownToast[] }))
vi.mock('@/platform/feedback', () => ({
  toast: {
    success: (message: string, options?: Omit<ShownToast, 'kind' | 'message'>) =>
      feedback.toasts.push({ kind: 'success', message, ...options }),
    error: (message: string, options?: Omit<ShownToast, 'kind' | 'message'>) =>
      feedback.toasts.push({ kind: 'error', message, ...options }),
  },
}))

afterEach(() => {
  feedback.toasts.length = 0
  net.requests.length = 0
  net.parents.clear()
  net.refuse = null
  net.states.clear()
  net.refuseRestore = null
})

/** The items as a move left them: in `marketing`, each having come from its own folder. */
function moved(from: Record<string, string>) {
  for (const name of Object.keys(from)) net.parents.set(name, 'marketing')
  return Object.entries(from).map(([node, folder]) => ({
    node,
    title: node,
    from: folder,
    to: 'marketing',
  }))
}

function undo(index = 0) {
  const shown = feedback.toasts[index]!
  expect(shown.action?.label).toBe('Undo')
  shown.action!.onClick()
}

describe('Move toast with Undo', () => {
  it('names the item and the folder, and Undo puts it back in the folder it came from', async () => {
    announceMove(moved({ 'Report.pdf': 'projects' }), 'Marketing')
    expect(feedback.toasts).toMatchObject([
      { kind: 'success', message: 'Moved “Report.pdf” to Marketing' },
    ])

    undo()
    await vi.waitFor(() => expect(feedback.toasts).toHaveLength(2))
    expect(net.parents.get('Report.pdf')).toBe('projects')
    expect(feedback.toasts[1]).toMatchObject({
      kind: 'success',
      message: 'Moved “Report.pdf” back',
    })
  })

  it('puts several items back in their own folders, and Undo runs only once', async () => {
    announceMove(moved({ a: 'projects', b: 'projects', c: 'archive' }), 'Marketing')
    expect(feedback.toasts[0]!.message).toBe('Moved 3 items to Marketing')

    undo()
    undo()
    await vi.waitFor(() => expect(feedback.toasts).toHaveLength(2))
    expect(Object.fromEntries(net.parents)).toEqual({ a: 'projects', b: 'projects', c: 'archive' })
    // The batch route, once for each folder the items came from.
    expect(net.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST nodes/batch',
      'POST nodes/batch',
    ])
    expect(feedback.toasts[1]).toMatchObject({ kind: 'success', message: 'Moved 3 items back' })
  })

  it('shows the server’s reason when an item cannot go back', async () => {
    net.refuse = {
      parent: 'projects',
      message: 'A file named “Report.pdf” is already in Projects.',
    }
    announceMove(moved({ 'Report.pdf': 'projects' }), 'Marketing')

    undo()
    await vi.waitFor(() => expect(feedback.toasts).toHaveLength(2))
    expect(net.parents.get('Report.pdf')).toBe('marketing')
    expect(feedback.toasts[1]).toMatchObject({
      kind: 'error',
      message: 'Could not move “Report.pdf” back',
      description: 'A file named “Report.pdf” is already in Projects.',
    })
  })

  it('leaves an item a later move took elsewhere, and puts back the rest', async () => {
    announceMove(moved({ a: 'projects', b: 'projects' }), 'Marketing')
    net.parents.set('b', 'archive')
    announceMove([{ node: 'b', title: 'b', from: 'marketing', to: 'archive' }], 'Archive')

    undo(0)
    await vi.waitFor(() => expect(feedback.toasts).toHaveLength(3))
    expect(Object.fromEntries(net.parents)).toEqual({ a: 'projects', b: 'archive' })
    expect(feedback.toasts[2]).toMatchObject({
      kind: 'error',
      message: 'Could not move “b” back',
      description: 'It changed again after that.',
    })
  })

  it('takes back moves of one item in either order, each from where the other left it', async () => {
    announceMove(moved({ a: 'projects' }), 'Marketing')
    net.parents.set('a', 'archive')
    announceMove([{ node: 'a', title: 'a', from: 'marketing', to: 'archive' }], 'Archive')

    // Undo of the later move first, then the earlier one finds the item where it put it.
    undo(1)
    await vi.waitFor(() => expect(net.parents.get('a')).toBe('marketing'))
    undo(0)
    await vi.waitFor(() => expect(net.parents.get('a')).toBe('projects'))
    expect(feedback.toasts.slice(2)).toMatchObject([
      { kind: 'success', message: 'Moved “a” back' },
      { kind: 'success', message: 'Moved “a” back' },
    ])
  })

  it('leaves an item someone else moved on since, and says so from the server', async () => {
    // Undo names the folder it expects each item in. The server refuses the
    // one that another tab moved on, and moves the rest back.
    announceMove(moved({ a: 'projects', b: 'projects' }), 'Marketing')
    net.parents.set('b', 'archive')

    undo()
    await vi.waitFor(() => expect(feedback.toasts).toHaveLength(2))
    expect(net.requests.at(-1)?.body).toEqual({
      nodes: ['a', 'b'],
      patch: { parent_node: 'projects', expect_parent_node: 'marketing' },
    })
    expect(Object.fromEntries(net.parents)).toEqual({ a: 'projects', b: 'archive' })
    expect(feedback.toasts[1]).toMatchObject({
      kind: 'error',
      message: 'Could not move “b” back',
      description: 'b has moved since you last saw it',
    })
  })

  it('reports a copy with no Undo, since the copy can be deleted', () => {
    announceCopy({ node: 'copy-1', title: 'Report.pdf' }, 'Archive')
    expect(feedback.toasts).toEqual([
      { kind: 'success', message: 'Copied “Report.pdf” to Archive' },
    ])
  })

  it('shows a title as typed, not as markup', () => {
    announceMove(moved({ '<b>notes</b>.txt': 'projects' }), 'R&D')
    expect(feedback.toasts[0]!.message).toBe('Moved “&lt;b&gt;notes&lt;/b&gt;.txt” to R&amp;D')
  })
})

describe('Trash and restore toasts with Undo', () => {
  /** Items in the state the change left them in. */
  function changed(state: string, ...names: string[]) {
    for (const name of names) net.states.set(name, state)
    return names.map((node) => ({ node, title: node }))
  }

  it('reports a move to Trash, and Undo restores the item', async () => {
    announceTrash(changed('Trashed', 'Report.pdf'))
    expect(feedback.toasts).toMatchObject([
      { kind: 'success', message: 'Moved “Report.pdf” to Trash' },
    ])

    undo()
    await vi.waitFor(() => expect(feedback.toasts).toHaveLength(2))
    expect(net.states.get('Report.pdf')).toBe('Active')
    expect(feedback.toasts[1]).toMatchObject({ kind: 'success', message: 'Restored “Report.pdf”' })
  })

  it('reports a restore of several items, and Undo moves them back to Trash once', async () => {
    announceRestore(changed('Active', 'a', 'b', 'c'))
    expect(feedback.toasts[0]!.message).toBe('Restored 3 items')

    undo()
    undo()
    await vi.waitFor(() => expect(feedback.toasts).toHaveLength(2))
    expect(Object.fromEntries(net.states)).toEqual({ a: 'Trashed', b: 'Trashed', c: 'Trashed' })
    expect(net.requests).toHaveLength(1)
    expect(feedback.toasts[1]).toMatchObject({
      kind: 'success',
      message: 'Moved 3 items back to Trash',
    })
  })

  it('names the items Undo could not restore, with the server’s reason', async () => {
    net.refuseRestore = { node: 'b', message: 'The folder “b” was in is in Trash.' }
    announceTrash(changed('Trashed', 'a', 'b'))

    undo()
    await vi.waitFor(() => expect(feedback.toasts).toHaveLength(2))
    expect(Object.fromEntries(net.states)).toEqual({ a: 'Active', b: 'Trashed' })
    expect(feedback.toasts[1]).toMatchObject({
      kind: 'error',
      message: 'Could not restore “b”',
      description: 'The folder “b” was in is in Trash.',
    })
  })
})
