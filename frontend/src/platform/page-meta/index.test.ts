import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { applyRouteMeta, installPageMeta, openingTitleState, usePageTitle } from './index'

describe('page meta', () => {
  it('arbitrates title overrides and restores the route fallback', () => {
    applyRouteMeta({ meta: { title: 'Files', favicon: '/files.svg' } } as any)
    expect(document.title).toBe('Files')
    expect(document.querySelector<HTMLLinkElement>("link[rel='icon']")?.href).toContain(
      '/files.svg',
    )

    const releaseFirst = usePageTitle(() => 'Folder')
    const releaseSecond = usePageTitle(() => 'Document')
    expect(document.title).toBe('Document')
    releaseSecond()
    expect(document.title).toBe('Folder')
    releaseFirst()
    expect(document.title).toBe('Files')
  })

  it('tracks a reactive view title and releases it with its Vue scope', async () => {
    applyRouteMeta({ meta: { title: 'Files' } } as any)
    const title = ref('Quarterly plan')
    const scope = effectScope()
    scope.run(() => usePageTitle(() => title.value))
    expect(document.title).toBe('Quarterly plan')
    title.value = 'Annual plan'
    await nextTick()
    expect(document.title).toBe('Annual plan')
    scope.stop()
    expect(document.title).toBe('Files')
  })

  it('applies route metadata only after successful navigation and removes its hook', () => {
    let afterEach: ((to: any, from: any, failure?: unknown) => void) | undefined
    const remove = vi.fn()
    const router = {
      currentRoute: { value: { meta: { title: 'Home', favicon: '/home.png' } } },
      options: { history: { state: {} } },
      afterEach: vi.fn((handler) => {
        afterEach = handler
        return remove
      }),
    }
    const uninstall = installPageMeta(router as any)
    expect(document.title).toBe('Home')
    expect(document.querySelector<HTMLLinkElement>("link[rel='icon']")?.type).toBe('image/png')
    afterEach?.({ meta: { title: 'Ignored' } }, {}, new Error('cancelled'))
    expect(document.title).toBe('Home')
    afterEach?.({ meta: { title: 'Document', favicon: '/document.svg?v=1' } }, {})
    expect(document.title).toBe('Document')
    expect(document.querySelector<HTMLLinkElement>("link[rel='icon']")?.type).toBe('image/svg+xml')
    uninstall()
    expect(remove).toHaveBeenCalledOnce()
  })

  it('names the page from its history entry until the page names itself', () => {
    applyRouteMeta({ meta: { title: 'Opening…' } } as any, openingTitleState('Q3 plan'))
    expect(document.title).toBe('Q3 plan')
    const release = usePageTitle(() => 'Q3 plan (renamed)')
    expect(document.title).toBe('Q3 plan (renamed)')
    release()
    applyRouteMeta({ meta: { title: 'Opening…' } } as any, openingTitleState(''))
    expect(document.title).toBe('Opening…')
  })
})
