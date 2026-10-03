import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MeetRequestError, request, submit } from './request'

describe('request', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.csrf_token = 'csrf-token'
  })

  it('posts JSON with Frappe headers and returns data', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(request('/api/suite/meet/rooms/joins', { value: 1 })).resolves.toEqual({
      ok: true,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/suite/meet/rooms/joins',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ value: 1 }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json; charset=utf-8',
          'X-Frappe-CSRF-Token': 'csrf-token',
          'X-Frappe-Site-Name': window.location.hostname,
        }),
      }),
    )
  })

  it('throws structured errors without legacy response fallbacks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [{ type: 'PermissionError', message: 'Not permitted', title: 'Forbidden' }],
          message: 'legacy fallback',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const error = await request('/api/suite/meet/rooms/joins').catch((value) => value)
    expect(error).toBeInstanceOf(MeetRequestError)
    expect(error).toMatchObject({
      status: 403,
      message: 'Not permitted',
    })
  })

  it('rejects unsupported paths before sending a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(
      request(('/api/' + 'method/example.run') as `/api/suite/meet/${string}`),
    ).rejects.toThrow('absolute /api/suite/meet/ path')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects failed frappe-ui calls instead of resolving null', async () => {
    const error = new Error('Not permitted')
    await expect(submit({ error, submit: vi.fn().mockResolvedValue(null) })).rejects.toBe(error)
  })
})
