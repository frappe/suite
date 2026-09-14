import { describe, expect, it } from 'vitest'

import { applyRouteMeta, usePageTitle } from './index'

describe('page meta', () => {
  it('arbitrates title overrides and restores the route fallback', () => {
    applyRouteMeta({ meta: { title: 'Files', favicon: '/files.svg' } } as any)
    expect(document.title).toBe('Files')
    expect(document.querySelector<HTMLLinkElement>("link[rel='icon']")?.href).toContain('/files.svg')

    const releaseFirst = usePageTitle(() => 'Folder')
    const releaseSecond = usePageTitle(() => 'Document')
    expect(document.title).toBe('Document')
    releaseSecond()
    expect(document.title).toBe('Folder')
    releaseFirst()
    expect(document.title).toBe('Files')
  })
})
