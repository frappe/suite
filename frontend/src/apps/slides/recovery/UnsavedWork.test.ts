import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { keepRecovery } from '@/apps/slides/surface/recovery'
import { requireTestElement } from '@/platform/testing/dom'
import { translationPlugin } from '@/platform/translation'

vi.mock('@/apps/drive', async (original) => ({
  ...(await original<typeof import('@/apps/drive')>()),
  driveDocumentIcon: () => ['file-icon-slides', 'text-ink-orange-6'],
  formatDriveBytes: (bytes: number) => `${bytes} B`,
  formatDriveListingDate: () => 'Just now',
  loadDriveNodeSummary: async (node: string) => ({ name: node, title: 'Plan', state: 'Active' }),
  driveNodeRoute: (node: { name: string }) => ({ path: `/d/${node.name}/plan` }),
}))
vi.mock('@/apps/slides', () => ({ slidesDocument: { contentDoctype: 'Presentation' } }))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const query = vi.hoisted(() => vi.fn())
vi.mock('@/api', () => ({
  api: { slides: { recovery: { names: 'recovery.names' } } },
  client: { query },
}))

const { discardCopy, listCopies } = await import('./copies')
const { default: UnsavedWork } = await import('./UnsavedWork.vue')

async function openedPage(ready: (root: Element) => unknown) {
  const routes = [
    { path: '/drive/recovery', component: UnsavedWork },
    { path: '/d/:node/:slug', component: { render: () => null } },
  ]
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/drive/recovery')
  await router.isReady()

  const root = window.document.createElement('div')
  window.document.body.append(root)
  createApp({ render: () => h(RouterView) })
    .use(router)
    .use(translationPlugin)
    .mount(root)
  await vi.waitFor(() => expect(ready(root)).toBeTruthy())
  return { root, router }
}

function rows(root: Element) {
  return [...root.querySelectorAll('[data-slot="list-row"]:not([aria-hidden="true"])')]
}

beforeEach(() => {
  localStorage.clear()
  query.mockReset()
})

afterEach(async () => {
  document.body.innerHTML = ''
  await Promise.all((await listCopies()).map(discardCopy))
})

describe("Slides' recovery copies on Drive's page", () => {
  it("shows a copy under its presentation's title, and opens the presentation", async () => {
    query.mockResolvedValue([
      { presentation: 'deck-plan', node: 'node-plan', title: 'Quarterly Plan' },
    ])
    keepRecovery('node-plan', [{ name: 'row-1' }], { sticky: true })

    const { root, router } = await openedPage((page) => rows(page).length)

    expect(rows(root)[0]!.textContent).toContain('Quarterly Plan')
    requireTestElement(rows(root)[0], HTMLElement).click()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/d/node-plan/plan'))
  })

  it("names a copy of a presentation the person can't read as untitled, and stays", async () => {
    query.mockResolvedValue([])
    keepRecovery('node-hidden', [{ name: 'row-1' }], { sticky: true })

    const { root, router } = await openedPage((page) => rows(page).length)

    expect(rows(root)[0]!.textContent).toContain('Untitled presentation')
    requireTestElement(rows(root)[0], HTMLElement).click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(router.currentRoute.value.path).toBe('/drive/recovery')
  })

  it('says so when the device keeps no copies', async () => {
    const { root } = await openedPage((page) => page.textContent?.includes('No recovery copies'))

    expect(rows(root)).toEqual([])
  })
})
