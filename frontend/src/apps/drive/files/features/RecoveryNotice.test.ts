import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { DOCUMENT_TYPES_KEY, type UnsavedCopy } from '@/platform/contracts'

vi.mock('frappe-ui', async () => ({
  Alert: (await import('../../../../../../node_modules/frappe-ui/src/components/Alert/Alert.vue'))
    .default,
}))

const { default: RecoveryNotice } = await import('./RecoveryNotice.vue')

let kept: UnsavedCopy[] = []

async function openedNotice() {
  const routes = [
    { path: '/drive', component: RecoveryNotice },
    { path: '/drive/recovery', component: { render: () => null } },
  ]
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/drive')
  await router.isReady()

  const writer = { key: 'writer', listUnsavedCopies: async () => kept }
  const root = document.createElement('div')
  document.body.append(root)
  createApp({ render: () => h(RouterView) })
    .provide(DOCUMENT_TYPES_KEY, [writer] as never)
    .use(router)
    .mount(root)
  for (let tick = 0; tick < 5; tick++) {
    await new Promise((done) => setTimeout(done))
  }

  return { root, router }
}

function button(root: Element, name: string) {
  const buttons = [...root.querySelectorAll('button')]
  return buttons.find((found) => (found.textContent ?? found.ariaLabel)?.includes(name))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Drive recovery notice', () => {
  it('counts documents, not copies, and Review opens the recovery copies page', async () => {
    kept = [{ document: 'node-1' }, { document: 'node-1' }, { document: 'node-2' }]
    const { root, router } = await openedNotice()

    expect(root.textContent).toContain("2 documents have changes that couldn't be saved.")
    button(root, 'Review')!.click()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/drive/recovery'))
  })

  it('shows in the Alert’s gray, as Drive’s other notices do', async () => {
    kept = [{ document: 'node-1' }]
    const { root } = await openedNotice()

    expect(root.querySelector('[role="status"]')!.getAttribute('data-color')).toBe('gray')
  })

  it('names a single document in the singular', async () => {
    kept = [{ document: 'node-1' }]
    const { root } = await openedNotice()

    expect(root.textContent).toContain("1 document has changes that couldn't be saved.")
  })

  it('shows nothing when the device keeps no copies', async () => {
    kept = []
    const { root } = await openedNotice()

    expect(root.querySelector('[role="status"]')).toBeNull()
    expect(root.textContent).toBe('')
  })

  it('has no dismiss button, so it shows while the device keeps copies', async () => {
    kept = [{ document: 'node-1' }]
    const { root } = await openedNotice()

    expect(root.textContent).toContain('1 document has')
    expect(root.querySelector('[aria-label="Dismiss"]')).toBeNull()
  })
})
