import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { translate } from '@/platform/translation'

import EditDomainModal from './EditDomainModal.vue'

// A Frappe that refuses every save with a reason the dialog should show.
vi.hoisted(() => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        exc_type: 'ValidationError',
        _server_messages: JSON.stringify([
          JSON.stringify({ message: 'Catch-all address must be on this domain.' }),
        ]),
      }),
      { status: 417, headers: { 'Content-Type': 'application/json' } },
    )
})

const toasts = vi.hoisted(() => {
  const shown: string[] = []
  return shown
})
vi.mock('frappe-ui', async (importOriginal) => {
  const { defineComponent } = await import('vue')
  return {
    ...(await importOriginal<typeof import('frappe-ui')>()),
    toast: {
      error: (message: string) => toasts.push(message),
      success: () => {},
      dismiss: () => {},
    },
    FormControl: defineComponent({ template: '<input />' }),
    Switch: defineComponent({ template: '<span />' }),
    ErrorMessage: defineComponent({
      props: ['message'],
      template: '<p v-if="message" data-test="error">{{ message }}</p>',
    }),
    Dialog: defineComponent({
      props: ['open', 'actions'],
      template: `<div v-if="open"><slot /><button v-for="action in actions"
        @click="action.onClick?.({ close: () => {} })">{{ action.label }}</button></div>`,
    }),
  }
})

const apps: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  toasts.length = 0
})

describe('an admin dialog whose save is refused', () => {
  it('shows the reason once, in the dialog, with no toast on top', async () => {
    const element = document.createElement('div')
    document.body.append(element)
    const app = createApp({
      render: () =>
        h(EditDomainModal, {
          modelValue: true,
          domain: { id: 'example.com', name: 'example.com' },
        }),
    })
    app.config.globalProperties.__ = translate
    // The refused save is the dialog's to report; keep it from failing the run.
    app.config.errorHandler = () => {}
    app.use(createRouter({ history: createMemoryHistory(), routes: [] }))
    apps.push(app)
    app.mount(element)
    await nextTick()
    element.querySelector('button')!.click()
    await vi.waitFor(() =>
      expect(element.querySelector('[data-test="error"]')?.textContent).toBe(
        'Catch-all address must be on this domain.',
      ),
    )
    // Feedback for a refused write arrives a turn later; give it the chance.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(toasts).toEqual([])
  })
})
