import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import ForgotPasswordView from './ForgotPasswordView.vue'
import ResetPasswordView from './ResetPasswordView.vue'

vi.mock('frappe-ui', () => ({
  Alert: defineComponent({
    props: ['title', 'description'],
    template: '<div role="alert">{{ title }} {{ description }}</div>',
  }),
  Button: defineComponent({
    props: ['label'],
    template: '<button type="submit">{{ label }}<slot /></button>',
  }),
  ErrorMessage: defineComponent({
    props: ['message'],
    template: '<p v-if="message">{{ message }}</p>',
  }),
  FormControl: defineComponent({
    props: ['modelValue', 'label'],
    emits: ['update:modelValue'],
    template: `<input :aria-label="label" :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)" />`,
  }),
}))

// The server answers a reset key it does not know with null, and a reset request with null
// whether or not the account exists.
vi.hoisted(() => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: null }))
})

const apps: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function open(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'mail-login', component: { render: () => null } },
      { path: '/reset-password', name: 'mail-forgot-password', component: ForgotPasswordView },
      {
        path: '/reset-password/:requestKey',
        name: 'mail-reset-password',
        component: ResetPasswordView,
        props: true,
      },
    ],
  })
  await router.push(path)
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp({ render: () => h(RouterView) })
  app.config.globalProperties.__ = (text: string) => text
  app.use(router)
  apps.push(app)
  app.mount(element)
  await settle()
  return { element, router }
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve))
    await nextTick()
  }
}

describe('Password reset', () => {
  it('says the link failed when a reset link is not recognised', async () => {
    const { element, router } = await open('/reset-password/stale-key')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('mail-forgot-password'))
    await settle()
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'This reset link has expired or does not work',
    )
  })

  it('shows no link warning when the form is opened directly', async () => {
    const { element } = await open('/reset-password')

    expect(element.querySelector('[role="alert"]')).toBeNull()
  })

  it('offers a way back to log in once the link is sent', async () => {
    const { element, router } = await open('/reset-password')
    const input = element.querySelector('input')!
    input.value = 'jordan@northwind.test'
    input.dispatchEvent(new Event('input'))
    element.querySelector('form')!.dispatchEvent(new Event('submit'))
    await settle()

    expect(element.querySelector('form')).toBeNull()
    const back = Array.from(element.querySelectorAll('a')).find(
      (link) => link.textContent?.trim() === 'Back to log in',
    )
    expect(back).toBeDefined()
    back!.click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('mail-login'))
  })
})
