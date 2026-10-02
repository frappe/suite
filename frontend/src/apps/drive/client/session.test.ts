import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCESS_REFRESH_MS, CREDENTIAL_CAP, CredentialOverflowError, MEDIA_REFRESH_MS, openDriveDocumentSession } from './session'
import { TransportError, type Transport } from '@/platform/transport'

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

  it('looks up a node held without a link once, not before every request', async () => {
    const looked: string[] = []
    const requester = transport((id, input) => {
      if (id !== 'node_get') return {}
      looked.push(input.node)
      return documentNode(input.node)
    })
    const session = await openDriveDocumentSession('root', { transport: requester })

    for (let request = 0; request < 3; request++) {
      expect(await session.credentials.codesFor(['root', 'other'])).toEqual([])
    }

    expect(looked).toEqual(['root', 'other'])
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

describe('document session access refresh', () => {
  const failure = (type: string, status: number) => new TransportError({ type, message: type, status })

  it('keeps access through network and server errors and refuses on a real answer', async () => {
    vi.useFakeTimers()
    let answer: TransportError | null = null
    const requester: Transport = {
      request: (operation, input: any) =>
        operation.id === 'node_get' && answer ? Promise.reject(answer) : Promise.resolve(documentNode(input.node) as never),
    }
    const session = await openDriveDocumentSession('root', { transport: requester, signedIn: () => 'Administrator' })

    for (const error of [failure('NetworkError', 0), failure('ServerError', 500), failure('Timeout', 408)]) {
      answer = error
      await vi.advanceTimersByTimeAsync(ACCESS_REFRESH_MS)
      expect(session.state.value).toBe('Active')
      expect(session.access.value.role).toBe(40)
    }

    answer = failure('DriveNotFound', 404)
    await vi.advanceTimersByTimeAsync(ACCESS_REFRESH_MS)
    expect(session.state.value).toBe('Refused')
    expect(session.access.value).toEqual({})
    session.dispose()
  })

  it('keeps access when signed out elsewhere, so the editor can say so', async () => {
    let answer: TransportError | null = null
    let user: string | null = 'Administrator'
    let refused = 0
    const target = new EventTarget()
    const requester: Transport = {
      request: (operation, input: any) => {
        if (operation.id !== 'node_get' || !answer) return Promise.resolve(documentNode(input.node) as never)
        refused += 1
        return Promise.reject(answer)
      },
    }
    const session = await openDriveDocumentSession('root', { transport: requester, window: target as Window, signedIn: () => user })
    user = null
    for (const error of [failure('DriveNotFound', 404), failure('SessionExpired', 401), failure('PermissionError', 403)]) {
      answer = error
      const before = refused
      target.dispatchEvent(new Event('focus'))
      await vi.waitFor(() => expect(refused).toBe(before + 1))
      await Promise.resolve()
      expect(session.state.value).toBe('Active')
      expect(session.access.value.role).toBe(40)
    }

    user = 'Administrator'
    target.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(session.state.value).toBe('Refused'))
    session.dispose()
  })
})
