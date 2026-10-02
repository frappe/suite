import { createApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A Drive server that keeps each node's state. Its purge route can fail once.
const net = vi.hoisted(() => {
  const state = {
    states: new Map<string, string>(),
    purges: 0,
    failNextPurge: false,
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  globalThis.fetch = async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(url), 'http://drive.test').pathname.replace('/api/suite/drive/', '')
    const body = init.body ? JSON.parse(String(init.body)) : null
    if (init.method === 'POST' && path === 'nodes/batch/purge') {
      state.purges += 1
      if (state.failNextPurge) {
        state.failNextPurge = false
        return json({ errors: [{ type: 'ServerError', message: 'Drive is busy' }] }, 503)
      }
      const { nodes } = body as { nodes: string[] }
      for (const name of nodes) state.states.delete(name)
      return json({ data: { ok: nodes, failed: [] } })
    }
    if (init.method === 'POST' && path === 'nodes/batch') {
      const { nodes, patch } = body as { nodes: string[]; patch: { state: string } }
      for (const name of nodes) state.states.set(name, patch.state)
      return json({ data: { ok: nodes, failed: [] } })
    }
    return json({ errors: [{ type: 'NotFound', message: path }] }, 404)
  }
  return state
})

interface ShownToast {
  kind: 'success' | 'error'
  message: string
  action?: { label: string; onClick: () => void }
}
const feedback = vi.hoisted(() => ({ toasts: [] as ShownToast[] }))
vi.mock('@/platform/feedback', () => ({
  confirm: async () => true,
  toast: {
    success: (message: string, options?: Omit<ShownToast, 'kind' | 'message'>) =>
      feedback.toasts.push({ kind: 'success', message, ...options }),
    error: (message: string, options?: Omit<ShownToast, 'kind' | 'message'>) =>
      feedback.toasts.push({ kind: 'error', message, ...options }),
  },
}))

import { useTrashActions } from './useTrashActions'

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  feedback.toasts.length = 0
  net.states.clear()
  net.purges = 0
})

function mountActions() {
  let actions!: ReturnType<typeof useTrashActions>
  const app = createApp(
    defineComponent({
      setup() {
        actions = useTrashActions(() => null)
        return () => h('div')
      },
    }),
  )
  app.mount(document.createElement('div'))
  unmount = () => app.unmount()
  return actions
}

const items = (...names: string[]) => names.map((name) => ({ node: name, title: name }))

describe('Trash actions', () => {
  it('reports a restore in a toast whose Undo moves the item back to Trash', async () => {
    const actions = mountActions()
    net.states.set('Report.pdf', 'Trashed')

    await actions.restore(items('Report.pdf'))
    expect(net.states.get('Report.pdf')).toBe('Active')
    expect(feedback.toasts).toMatchObject([{ kind: 'success', message: 'Restored “Report.pdf”', action: { label: 'Undo' } }])

    feedback.toasts[0]!.action!.onClick()
    await vi.waitFor(() => expect(feedback.toasts).toHaveLength(2))
    expect(net.states.get('Report.pdf')).toBe('Trashed')
    expect(feedback.toasts[1]).toMatchObject({ kind: 'success', message: 'Moved “Report.pdf” back to Trash' })
  })

  it('reports Delete forever in a toast with no Undo', async () => {
    const actions = mountActions()

    await actions.purge(items('a', 'b'))
    expect(feedback.toasts).toEqual([{ kind: 'success', message: 'Deleted 2 items forever' }])
  })

  it('offers Retry when a whole request fails, and Retry sends the same request without asking again', async () => {
    const actions = mountActions()
    net.failNextPurge = true

    expect(await actions.purge(items('a', 'b'))).toBeNull()
    expect(feedback.toasts).toMatchObject([{ kind: 'error', message: 'Drive is busy', action: { label: 'Retry' } }])

    feedback.toasts[0]!.action!.onClick()
    await vi.waitFor(() => expect(actions.outcome.value).toEqual({ ok: ['a', 'b'], failed: [] }))
    expect(actions.verb.value).toBe('deleted forever')
    expect(net.purges).toBe(2)
    expect(feedback.toasts[1]).toMatchObject({ kind: 'success', message: 'Deleted 2 items forever' })
  })
})
