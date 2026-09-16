import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@/platform/transport', () => ({
  transport: { request: mocks.request },
}))

beforeEach(() => {
  vi.resetModules()
  mocks.request.mockReset()
  window.translatedMessages = {}
  window.__ = undefined
})

describe('translation', () => {
  it('uses context first and supports indexed and named replacements', async () => {
    mocks.request.mockReturnValueOnce(new Promise(() => {}))
    window.translatedMessages = {
      Save: 'Guardar',
      'Save:Button': 'Guardar botón',
      'Hello {0}': 'Hola {0}',
      'Hello {name}': 'Hola {name}',
    }
    const { translate } = await import('./index')
    expect(translate('Save', undefined, 'Button')).toBe('Guardar botón')
    expect(translate('Hello {0}', ['Faris'])).toBe('Hola Faris')
    expect(translate('Hello {name}', { name: 'Faris' })).toBe('Hola Faris')
  })

  it('loads the site catalog once from the Frappe translation route', async () => {
    mocks.request.mockResolvedValueOnce({ Save: 'Guardar' })
    const { loadTranslations, ready, translate } = await import('./index')
    await ready
    await Promise.all([loadTranslations(), loadTranslations()])
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(mocks.request.mock.calls[0]?.[0]).toMatchObject({
      id: 'frappe.translate.get_boot_translations',
      method: 'GET',
      path: '/api/v2/method/frappe.translate.get_boot_translations',
    })
    expect(window.translatedMessages).toEqual({ Save: 'Guardar' })
    expect(translate('Save')).toBe('Guardar')
  })

  it('installs the global translator after catalog readiness', async () => {
    let release!: (catalog: Record<string, string>) => void
    mocks.request.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    const { installTranslation } = await import('./index')
    const app = {
      config: { globalProperties: {} as Record<string, unknown> },
      use(plugin: { install(target: any): void }) {
        plugin.install(this)
        return this
      },
    }
    let installed = false
    const pending = installTranslation(app as any).then(() => { installed = true })
    expect(typeof app.config.globalProperties.__).toBe('function')
    expect(window.__).toBe(app.config.globalProperties.__)
    expect(installed).toBe(false)
    release({ Open: 'Abrir' })
    await pending
    expect(window.__?.('Open')).toBe('Abrir')
  })

  it('falls back to source strings when catalog loading fails', async () => {
    mocks.request.mockRejectedValueOnce(new Error('offline'))
    const { ready, translate } = await import('./index')
    await expect(ready).resolves.toBeUndefined()
    expect(translate('Try again')).toBe('Try again')
  })
})
