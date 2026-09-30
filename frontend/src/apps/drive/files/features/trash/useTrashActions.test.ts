import { createApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A Drive server whose purge route fails once, then works.
const net = vi.hoisted(() => {
  const state = { purges: 0, failNext: true }
  globalThis.fetch = async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(url), 'http://drive.test').pathname.replace('/api/suite/drive/', '')
    if (init.method === 'POST' && path === 'nodes/batch/purge') {
      state.purges += 1
      if (state.failNext) {
        state.failNext = false
        return new Response(JSON.stringify({ errors: [{ type: 'ServerError', message: 'Drive is busy' }] }), { status: 503 })
      }
      const { nodes } = JSON.parse(String(init.body)) as { nodes: string[] }
      return new Response(JSON.stringify({ data: { ok: nodes, failed: [] } }), { status: 200 })
    }
    return new Response(JSON.stringify({ errors: [{ type: 'NotFound', message: path }] }), { status: 404 })
  }
  return state
})

const feedback = vi.hoisted(() => ({
  toasts: [] as Array<{ message: string; retry?: () => void }>,
}))
vi.mock('@/platform/feedback', () => ({
  confirm: async () => true,
  toast: {
    success: () => {},
    error: (message: string, options?: { action?: { onClick: () => void } }) =>
      feedback.toasts.push({ message, retry: options?.action?.onClick }),
  },
}))

import { useTrashActions } from './useTrashActions'

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

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

describe('Trash actions', () => {
  it('offers Retry when a whole request fails, and Retry sends the same request without asking again', async () => {
    const actions = mountActions()

    expect(await actions.purge(['a', 'b'])).toBeNull()
    expect(feedback.toasts).toHaveLength(1)
    expect(feedback.toasts[0]!.message).toBe('Drive is busy')

    feedback.toasts[0]!.retry!()
    await vi.waitFor(() => expect(actions.outcome.value).toEqual({ ok: ['a', 'b'], failed: [] }))
    expect(actions.verb.value).toBe('deleted forever')
    expect(net.purges).toBe(2)
  })
})
