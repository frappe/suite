import { describe, expect, it, vi } from 'vitest'

import type { CredentialGrouper } from '@/apps/drive'

import { createWriterDocument } from './writerDocument'

type Sent = { url: string; method: string; headers: Headers; body: unknown }

/** A session whose fetch adds the document's link code, as Drive's does. */
function fakeSession(answer: (request: Sent) => Response) {
  const sent: Sent[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('X-Drive-Links', 'link-code')
    const request = {
      url,
      method: init.method ?? 'GET',
      headers,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    }
    sent.push(request)
    return answer(request)
  })
  const credentials: CredentialGrouper = { fetch, fetchHeld: fetch, group: () => [] }
  return { session: { contentDocname: 'wd-1', credentials }, sent }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

const row = { name: 'wd-1', collab: 1, content: 'Y29udGVudA==', settings: '{"fullWidth":true}' }

describe('Writer document client', () => {
  it('loads the row and sends every save through the document session', async () => {
    window.csrf_token = 'csrf'
    const { session, sent } = fakeSession((request) =>
      json({ data: request.method === 'GET' ? row : null }),
    )
    const document = createWriterDocument(session)

    await vi.waitFor(() => expect(document.doc).not.toBeNull())
    expect(document.doc).toMatchObject({
      name: 'wd-1',
      content: 'Y29udGVudA==',
      settings: { fullWidth: true },
    })

    await document.saveDoc.submit({ data: 'update', html: '<p>Hi</p>' })
    await document.saveHtml.submit({ html: '<p>Hi</p>' })
    await document.saveComments.submit({ doc: 'wd-1', data: 'comments' })

    expect(sent.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /api/v2/document/Writer%20Document/wd-1',
      'POST /api/v2/document/Writer%20Document/wd-1/method/save_doc',
      'POST /api/v2/document/Writer%20Document/wd-1/method/save_html',
      'POST /api/v2/method/suite.writer.api.docs.save_comments',
    ])
    expect(sent.every(({ headers }) => headers.get('X-Drive-Links') === 'link-code')).toBe(true)
    expect(
      sent.slice(1).every(({ headers }) => headers.get('X-Frappe-CSRF-Token') === 'csrf'),
    ).toBe(true)
    expect(sent[1].body).toEqual({ data: 'update', html: '<p>Hi</p>' })
  })

  it('rejects a refused save with the error the server named, and keeps it on the write', async () => {
    const { session } = fakeSession((request) =>
      request.method === 'GET'
        ? json({ data: row })
        : json(
            { errors: [{ type: 'DriveForbidden', message: 'You cannot edit this document.' }] },
            403,
          ),
    )
    const document = createWriterDocument(session)

    const refused = document.saveHtml.submit({ html: '<p>Hi</p>' })

    await expect(refused).rejects.toMatchObject({
      type: 'DriveForbidden',
      status: 403,
      message: 'You cannot edit this document.',
    })
    expect(document.saveHtml.error).toMatchObject({ type: 'DriveForbidden' })
    expect(document.saveHtml.loading).toBe(false)
  })
})
