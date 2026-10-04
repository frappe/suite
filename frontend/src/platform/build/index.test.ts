import { beforeEach, describe, expect, it, vi } from 'vitest'

const info = vi.fn()
vi.mock('frappe-ui', () => ({ toast: { info } }))
vi.mock('@/platform/translation', () => ({
  translate: (text: string, replace: string[] = []) => text.replace('{0}', replace[0]),
}))

const respond = (headers: Record<string, string>) =>
  vi.fn(async () => new Response('{}', { headers }))

async function tabOnBuild(build: string, server: Record<string, string>) {
  vi.resetModules()
  vi.stubGlobal('__SUITE_BUILD__', build)
  vi.stubEnv('DEV', false)
  vi.stubGlobal('fetch', respond(server))
  const module = await import('./index')
  module.watchBuild()
  await window.fetch('/api/method/ping')
  return module
}

describe('build watcher', () => {
  beforeEach(() => info.mockClear())

  it('offers a reload once when the server runs a newer build', async () => {
    await tabOnBuild('200', { 'X-Suite-Build': '100' })
    expect(info).not.toHaveBeenCalled()

    await tabOnBuild('100', { 'X-Suite-Build': '200' })
    await window.fetch('/api/method/ping')
    expect(info).toHaveBeenCalledOnce()
    expect(info.mock.calls[0][1].action.label).toBe('Reload')
  })

  it('turns a product read-only below its minimum build and says why', async () => {
    const tab = await tabOnBuild('100', {
      'X-Suite-Build': '200',
      'X-Suite-Min-Builds': JSON.stringify({ writer: '150' }),
    })

    expect(tab.belowMinBuild('writer')).toBe(true)
    expect(tab.belowMinBuild('slides')).toBe(false)
    expect(info.mock.calls.at(-1)![1].description).toBe('Reload to keep editing in Writer.')
  })
})
