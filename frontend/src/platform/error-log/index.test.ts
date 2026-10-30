import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { TransportError, type Operation, type TransportOptions } from '@/platform/transport'
import type { ErrorsPostInput } from '@/platform/transport/generated'

const { request, status } = vi.hoisted(() => ({
  request: vi.fn(
    async (_operation: Operation, _input: ErrorsPostInput, _options?: TransportOptions) => null,
  ),
  status: { value: 'authenticated' },
}))
vi.mock('@/platform/session', () => ({ useSession: () => ({ status }) }))
vi.mock('@/platform/transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/transport')>()),
  transport: { request },
}))

let errorLog: typeof import('./index')
const uninstalls: (() => void)[] = []

beforeEach(async () => {
  vi.resetModules()
  errorLog = await import('./index')
  status.value = 'authenticated'
  window.history.replaceState({}, '', '/drive/l/SHARE_CODE?page=2&token=SECRET')
})
afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) uninstall()
  request.mockClear()
  window.history.replaceState({}, '', '/')
})

function reports() {
  return request.mock.calls.map(([operation, input, options]) => ({
    path: `${operation.prefix}${operation.path}`,
    ...input,
    options,
  }))
}

function mountBroken(onError = vi.fn()) {
  const Broken = defineComponent({
    name: 'BrokenWidget',
    setup() {
      return () => {
        throw new TypeError('cannot read title')
      }
    },
  })
  const app = createApp({ render: () => h(Broken) })
  app.config.errorHandler = onError
  uninstalls.push(errorLog.installErrorLog(app))
  app.mount(document.createElement('div'))
  return { app, onError }
}

it('records a component error with its component, route and stack, and keeps the earlier handler', () => {
  const { onError } = mountBroken()

  expect(reports()).toEqual([
    {
      path: '/api/suite/errors',
      source: 'component',
      title: 'TypeError: cannot read title',
      stack: expect.stringMatching(
        /cannot read title[\s\S]*Vue: render function in <BrokenWidget>$/,
      ),
      route: '/l/[Filtered]?page=2&token=[Filtered]',
      options: { keepalive: true },
    },
  ])
  expect(onError).toHaveBeenCalledOnce()
})

it('records an error once and stops after ten different errors in one page load', () => {
  for (let attempt = 0; attempt < 3; attempt++) errorLog.reportError(new Error('same'), 'script')
  for (let index = 0; index < 20; index++)
    errorLog.reportError(new Error(`error ${index}`), 'script')

  const titles = reports().map((report) => report.title)
  expect(titles).toEqual([
    'Error: same',
    ...Array.from({ length: 9 }, (_, i) => `Error: error ${i}`),
  ])
})

it('skips refusals the server already answered, cancelled work and browser noise', () => {
  errorLog.reportError(
    new TransportError({ type: 'PermissionError', message: 'No access', status: 403 }),
    'promise',
  )
  errorLog.reportError(
    new TransportError({ type: 'ServerError', message: 'Boom', status: 500 }),
    'promise',
  )
  errorLog.reportError(
    Object.assign(new Error('Bad input'), { exc_type: 'ValidationError' }),
    'promise',
  )
  errorLog.reportError(new DOMException('The user aborted a request.', 'AbortError'), 'promise')
  errorLog.reportError('Script error.', 'script')
  errorLog.reportError('ResizeObserver loop completed with undelivered notifications.', 'script')

  expect(reports()).toEqual([])
})

it('does not report for a visitor who is not signed in', () => {
  status.value = 'guest'
  errorLog.reportError(new Error('public page failed'), 'script')
  expect(reports()).toEqual([])
})

it('records uncaught script errors and rejected promises from the window', () => {
  uninstalls.push(errorLog.installErrorLog(createApp({})))
  window.dispatchEvent(new ErrorEvent('error', { error: new RangeError('out of range') }))
  const rejection = new Event('unhandledrejection')
  Object.assign(rejection, { reason: 'plain rejection' })
  window.dispatchEvent(rejection)

  expect(reports().map(({ source, title }) => ({ source, title }))).toEqual([
    { source: 'script', title: 'RangeError: out of range' },
    { source: 'promise', title: 'plain rejection' },
  ])
})

it('records a worker error with where it happened', () => {
  const worker = new EventTarget()
  errorLog.reportWorkerErrors(worker, 'PDF')
  worker.dispatchEvent(
    new ErrorEvent('error', {
      message: 'decode failed',
      filename: 'pdfWorker.js',
      lineno: 4,
      colno: 2,
    }),
  )

  expect(reports()).toEqual([
    expect.objectContaining({
      source: 'worker',
      title: 'PDF worker: decode failed',
      stack: 'at pdfWorker.js:4:2',
    }),
  ])
})

it('keeps reporting when the report itself fails', async () => {
  request.mockRejectedValueOnce(new Error('offline'))
  errorLog.reportError(new Error('first'), 'script')
  await Promise.resolve()
  errorLog.reportError(new Error('second'), 'script')
  expect(reports().map((report) => report.title)).toEqual(['Error: first', 'Error: second'])
})
