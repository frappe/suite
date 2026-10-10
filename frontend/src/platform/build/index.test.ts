import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastInfo = vi.fn()
vi.mock('frappe-ui', () => ({ toast: { info: toastInfo } }))
vi.mock('@/platform/translation', () => ({
  translate: (text: string, replace: string[] = []) => text.replace('{0}', replace[0]),
}))

const fakeFetch = (headers: Record<string, string>) =>
  vi.fn(async () => new Response('{}', { headers }))

async function tabOnBuild(build: string, serverHeaders: Record<string, string>) {
  vi.resetModules()
  vi.stubGlobal('__SUITE_BUILD__', build)
  vi.stubEnv('DEV', false)
  vi.stubGlobal('fetch', fakeFetch(serverHeaders))
  const buildModule = await import('./index')
  buildModule.watchBuild()
  await window.fetch('/api/method/ping')
  return buildModule
}

describe('build watcher', () => {
  beforeEach(() => toastInfo.mockClear())

  it('offers a reload once when the server runs a newer build', async () => {
    await tabOnBuild('200', { 'X-Suite-Build': '100' })
    expect(toastInfo).not.toHaveBeenCalled()

    await tabOnBuild('100', { 'X-Suite-Build': '200' })
    await window.fetch('/api/method/ping')
    expect(toastInfo).toHaveBeenCalledOnce()
    expect(toastInfo.mock.calls[0][1].action.label).toBe('Reload')
  })

  it('turns a product read-only below its minimum build and says why', async () => {
    const tab = await tabOnBuild('100', {
      'X-Suite-Build': '200',
      'X-Suite-Min-Builds': JSON.stringify({ writer: '150' }),
    })

    expect(tab.belowMinBuild('writer')).toBe(true)
    expect(tab.belowMinBuild('slides')).toBe(false)
    expect(toastInfo.mock.calls.at(-1)![1].description).toBe('Reload to keep editing in Writer.')
  })
})
