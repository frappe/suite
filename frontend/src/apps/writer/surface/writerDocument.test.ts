import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/api'
import type { DocumentSession } from '@/apps/drive'
import { TransportError } from '@/platform/transport'

import { createWriterDocument, isLocked } from './writerDocument'

const query = vi.hoisted(() => vi.fn())
vi.mock('@/api', async (original) => {
  const real = await original<typeof import('@/api')>()
  return { ...real, client: { ...real.client, query } }
})

const context = { links: ['link-1'] }

function opened() {
  const session = { contentDocname: 'content-1', credentials: { context } }
  return createWriterDocument(session as unknown as DocumentSession)
}

describe('locked documents', () => {
  it('lock a document only while the lock is set', () => {
    expect(isLocked({ lock: true })).toBe(true)
    expect(isLocked({ lock: null })).toBe(false)
    expect(isLocked({})).toBe(false)
  })
})

describe('the open document', () => {
  afterEach(() => query.mockReset())

  it("reads its row in the session's access scope, with stored settings read as an object", async () => {
    query.mockResolvedValue({ name: 'content-1', settings: '{"lock": 1}' })
    const document = opened()

    await vi.waitFor(() => expect(document.doc?.settings).toEqual({ lock: 1 }))
    expect(query.mock.calls).toEqual([
      [api.writer.documents.get, { name: 'content-1' }, { context }],
    ])
  })

  it('reads settings that are empty or not an object as none', async () => {
    for (const settings of ['', '[1]', null]) {
      query.mockResolvedValue({ name: 'content-1', settings })
      const document = opened()

      await vi.waitFor(() => expect(document.doc?.settings).toEqual({}))
    }
  })

  it('shows the row read again on reload', async () => {
    query.mockResolvedValue({ name: 'content-1', settings: '{}' })
    const document = opened()
    await vi.waitFor(() => expect(document.doc).not.toBeNull())

    query.mockResolvedValue({ name: 'content-1', settings: '{"lock": 1}' })
    await document.reload()

    expect(document.doc?.settings).toEqual({ lock: 1 })
  })

  it('holds no row, and says why, when the read fails', async () => {
    query.mockRejectedValue(new TransportError({ type: 'Server', message: '', status: 500 }))
    const document = opened()

    await vi.waitFor(() =>
      expect(document.readFailure).toBe(
        'The server had a problem opening this document. Try again in a moment.',
      ),
    )
    expect(document.doc).toBeNull()
  })

  it('shows the row once a failed read works on trying again', async () => {
    query.mockRejectedValue(new Error('dropped'))
    const document = opened()
    await vi.waitFor(() => expect(document.readFailure).not.toBeNull())

    query.mockResolvedValue({ name: 'content-1', settings: '{}' })
    await document.read()

    expect(document.readFailure).toBeNull()
    expect(document.doc?.name).toBe('content-1')
  })

  it('keeps the row, with no failure, when a later reload fails', async () => {
    query.mockResolvedValue({ name: 'content-1', settings: '{}' })
    const document = opened()
    await vi.waitFor(() => expect(document.doc).not.toBeNull())

    query.mockRejectedValue(new Error('dropped'))
    await expect(document.reload()).rejects.toThrow('dropped')

    expect(document.readFailure).toBeNull()
    expect(document.doc?.name).toBe('content-1')
  })
})
