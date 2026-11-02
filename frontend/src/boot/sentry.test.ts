import { serializeEnvelope } from '@sentry/core'
import * as Sentry from '@sentry/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { initSentry } from './sentry'

const { bodies } = vi.hoisted(() => ({ bodies: [] as (string | Uint8Array)[] }))
const app = createApp({})
vi.mock('@/boot/session', () => ({ getSessionUser: () => 'Guest' }))
vi.mock('@sentry/vue', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@sentry/vue')>()
  // Actual SDK serialization; no executor can send a network request.
  const transport = (options: Parameters<typeof sdk.makeFetchTransport>[0]) =>
    sdk.createTransport(options, async (request) => {
      bodies.push(request.body)
      return { statusCode: 200 }
    })
  return {
    ...sdk,
    replayIntegration: vi.fn(sdk.replayIntegration),
    makeFetchTransport: transport,
    init: (options: Parameters<typeof sdk.init>[0]) =>
      sdk.init({ ...options, transport: options.transport ?? transport }),
  }
})
afterEach(async () => {
  await Sentry.close()
  bodies.length = 0
  window.history.replaceState({}, '', '/')
})
it('redacts SDK error and trace envelopes, including initial URLs and later errors', async () => {
  const code = 'SYNTHETIC_SHARE_CANARY'
  const signature = 'SYNTHETIC_SIGNATURE_CANARY'
  const initial = `/d/example#link=${code}`
  window.history.replaceState({}, '', initial)
  window.sentry_dsn = 'https://synthetic@sentry.invalid/1'
  await initSentry(app, createRouter({ history: createMemoryHistory(), routes: [] }))
  const client = Sentry.getClient()
  expect(client).toBeDefined()
  Sentry.captureException(new Error(`Failed https://suite.invalid/l/${code}`))
  await Sentry.flush()
  window.history.replaceState({}, '', '/d/example')
  Sentry.addBreadcrumb({ category: 'navigation', data: { from: initial, to: '/d/example' } })
  Sentry.addBreadcrumb({
    category: 'fetch',
    data: { url: `/f/blob?e=123&s=${signature}&size=small` },
  })
  Sentry.setContext('resource', {
    referrer: `https://suite.invalid/drive/l/${code}`,
    url: `/f/blob?%73=${signature}&s=${signature}&token=${code}#link=${code}`,
    signed: `/f/blob?X-Amz-Credential=${signature}&X-Amz-Signature=${signature}&X-Goog-Signature=${signature}`,
    malformed: `/d/example?%ZZ=${code}&page=2`,
    fragment: `/d/example#%6cink=${code}&tab=details`,
  })
  Sentry.captureException(new Error(`Later failure /d/example#link=${code}`))
  Sentry.captureException(new Error('Harmless diagnostic'))
  Sentry.captureException(
    Object.assign(new Error('Excluded validation'), { exc_type: 'ValidationError' }),
  )
  await Sentry.flush()
  const serialized = bodies.join('\n')
  expect(serialized).not.toContain(code)
  expect(serialized).not.toContain(signature)
  expect(serialized).toContain('Harmless diagnostic')
  expect(serialized).toContain('/d/example')
  expect(serialized).toContain('size=small')
  expect(serialized).toContain('stacktrace')
  expect(serialized).toContain('page=2')
  expect(serialized).toContain('tab=details')
  expect(serialized).not.toContain('Excluded validation')
  // HttpContext ran in the actual SDK on both sides of router cleanup.
  expect(serialized).toContain('/d/example#link=[Filtered]')
  expect(client?.getIntegrationByName('Replay')).toBeDefined()
  expect(client?.getOptions().replaysOnErrorSampleRate).toBe(1)
  expect(serialized).not.toContain('replay_event')
  expect(serialized).not.toContain('replay_recording')
  await client?.getTransport()?.send([
    {},
    [
      [
        { type: 'transaction' },
        {
          type: 'transaction',
          transaction: initial,
          spans: [{ description: `/f/blob?s=${signature}`, data: { 'http.url': initial } }],
        },
      ],
    ],
  ])
  expect(bodies.at(-1)).not.toContain(code)
  expect(bodies.at(-1)).not.toContain(signature)
  expect(bodies.at(-1)).toContain('/f/blob')
})

it('does not initialize telemetry without a DSN', async () => {
  const previousClient = Sentry.getClient()
  window.sentry_dsn = ''
  await initSentry(app, createRouter({ history: createMemoryHistory(), routes: [] }))
  expect(bodies).toEqual([])
  expect(Sentry.getClient()).toBe(previousClient)
})

it('passes binary Replay through SDK serialization unchanged', async () => {
  window.sentry_dsn = 'https://synthetic@sentry.invalid/1'
  await initSentry(app, createRouter({ history: createMemoryHistory(), routes: [] }))
  const client = Sentry.getClient()!
  expect(Sentry.replayIntegration).toHaveBeenLastCalledWith({
    maskAllText: true,
    maskAllInputs: true,
    blockAllMedia: true,
    networkDetailAllowUrls: [],
    networkCaptureBodies: false,
    networkRequestHeaders: [],
    networkResponseHeaders: [],
  })
  expect(client.getOptions().replaysSessionSampleRate).toBe(0)
  expect(client.getOptions().replaysOnErrorSampleRate).toBe(1)
  const recording = new Uint8Array([0, 255, 120, 156, 42, 0])
  const envelope: Parameters<NonNullable<ReturnType<typeof client.getTransport>>['send']>[0] = [
    {},
    [
      [{ type: 'replay_event' }, { urls: ['https://suite.invalid/l/ACCEPTED_REPLAY_URL'] }],
      [{ type: 'replay_recording' }, recording],
    ],
  ]
  const expected = serializeEnvelope(envelope)
  await client.getTransport()!.send(envelope)
  expect(bodies.at(-1)).toEqual(expected)
  expect(recording).toEqual(new Uint8Array([0, 255, 120, 156, 42, 0]))
})
