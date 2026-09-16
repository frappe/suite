import { afterEach, describe, expect, it, vi } from 'vitest'
import { CREDENTIAL_CAP, CredentialOverflowError, MEDIA_REFRESH_MS, openDriveDocumentSession } from './session'
import type { Transport } from '@/platform/transport'

const documentNode = (name: string, code?: string) => ({
  name, title: name, kind: 'document', parent: 'p', root: 'r', state: 'Active', size: 0, mime: null,
  url: null, content_doctype: 'Presentation', content_docname: `doc-${name}`, is_template: 0,
  owner: 'Administrator', creation: null, modified: '2026-09-15', content_modified: null,
  access: { role: 40, via_link: code ? `$LINK:${code}` : null },
})

function transport(handler: (id: string, input: any) => any): Transport {
  return { request: (operation, input) => Promise.resolve(handler(operation.id, input)) }
}

afterEach(() => vi.useRealTimers())

describe('document session credentials', () => {
  it('partitions ordered references under the 20-code cap', async () => {
    const requester = transport((id, input) => id === 'node_get' ? documentNode(input.node, `code-${input.node}`) : {})
    const session = await openDriveDocumentSession('root', { transport: requester })
    const ids = Array.from({ length: CREDENTIAL_CAP + 1 }, (_, index) => `n${index}`)
    const groups = await session.credentials.group(ids)
    expect(groups.map((group) => group.nodeIds.length)).toEqual([20, 1])
    await expect(session.credentials.codesFor(ids)).rejects.toBeInstanceOf(CredentialOverflowError)
    session.dispose()
  })
})

describe('document session media', () => {
  it('refreshes signed media at ten minutes and keeps a signature-free cache key', async () => {
    vi.useFakeTimers()
    let mediaCalls = 0
    const requester = transport((id) => {
      if (id === 'node_get') return documentNode('root')
      if (id === 'node_media') {
        mediaCalls += 1
        return { media: [{ node: 'm1', url: `/f/blob?e=1&s=${mediaCalls}`, expires: 1 }] }
      }
      return {}
    })
    const session = await openDriveDocumentSession('root', { transport: requester })
    const handle = session.media('m1')
    await vi.runAllTicks()
    await Promise.resolve()
    expect(handle.cacheKey.value).toBe('drive-media:/f/blob')
    await vi.advanceTimersByTimeAsync(MEDIA_REFRESH_MS)
    expect(mediaCalls).toBeGreaterThanOrEqual(2)
    expect(handle.cacheKey.value).not.toContain('?')
    session.dispose()
  })
})
