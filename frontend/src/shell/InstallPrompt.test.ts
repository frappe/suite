import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import type { AreaDefinition } from '@/platform/contracts'
import { translate } from '@/platform/translation'
import InstallPrompt from '@/shell/InstallPrompt.vue'

// The app whose manifest the page links, as the platform keeps it.
const linked = vi.hoisted(() => ({ app: undefined as unknown as { value: string } }))
vi.mock('@/platform/pwa', async () => {
  const { shallowRef } = await import('vue')
  linked.app = shallowRef('suite')
  return { linkedPwaApp: linked.app }
})

// A dialog that draws its title, body and actions while open, as frappe-ui's does.
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Button: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          h('button', slots.default?.()),
    }),
    Dialog: defineComponent({
      props: { open: Boolean },
      setup:
        (props, { slots }) =>
        () =>
          props.open
            ? h('div', { role: 'dialog' }, [slots.title?.(), slots.default?.(), slots.actions?.()])
            : null,
    }),
  }
})

vi.stubGlobal('__', translate)

const area = (id: string, label: string): AreaDefinition => ({
  id,
  label: () => label,
  icon: defineComponent({ setup: () => () => h('span') }),
  to: `/${id}`,
  loadRoutes: vi.fn(),
})
const mail = area('mail', 'Mail')

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

async function mountAt(path: string, app: () => AreaDefinition | undefined) {
  const page = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/home', component: page, meta: { area: 'home' } },
      { path: '/mail', component: page, meta: { area: 'mail' } },
    ],
  })
  await router.push(path)
  const root = document.createElement('div')
  document.body.appendChild(root)
  const vue = createApp({ setup: () => () => [h(RouterView), h(InstallPrompt, { app: app() })] })
  vue.config.globalProperties.__ = translate
  vue.use(router)
  vue.mount(root)
  await router.isReady()
  cleanup = () => {
    vue.unmount()
    root.remove()
  }
  return { root, router }
}

/** The browser decides the page can be installed as the app it links. */
function fireInstallEvent() {
  const prompt = vi.fn(async () => {})
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt })
  window.dispatchEvent(event)
  return prompt
}

describe('the install offer', () => {
  it("installs the app it names, from that app's pages", async () => {
    linked.app.value = 'mail'
    const { root } = await mountAt('/mail', () => mail)
    const prompt = fireInstallEvent()
    await nextTick()

    expect(root.querySelector('[role="dialog"] h2')?.textContent).toBe('Install Mail')
    root.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click()
    expect(prompt).toHaveBeenCalled()
  })

  it("waits, on an app's pages, for the browser to offer that app", async () => {
    // The browser offered the Suite on Home, before Mail's pages were open.
    linked.app.value = 'suite'
    const current = shallowRef<AreaDefinition | undefined>(undefined)
    const { root, router } = await mountAt('/home', () => current.value)
    const suitePrompt = fireInstallEvent()
    await nextTick()

    linked.app.value = 'mail'
    current.value = mail
    await router.push('/mail')
    await nextTick()
    expect(root.querySelector('[role="dialog"]')).toBeNull()

    const mailPrompt = fireInstallEvent()
    await nextTick()
    expect(root.querySelector('[role="dialog"] h2')?.textContent).toBe('Install Mail')
    root.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click()
    expect(mailPrompt).toHaveBeenCalled()
    expect(suitePrompt).not.toHaveBeenCalled()
  })
})
