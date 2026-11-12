import { afterEach, describe, expect, it, vi } from 'vitest'

async function load() {
  vi.resetModules()
  return await import('./index')
}

afterEach(() => {
  delete window.suite_workspace_name
  vi.unstubAllGlobals()
})

describe('workspace', () => {
  it('starts from the name the server page booted, without asking the site', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    window.suite_workspace_name = '  Northwind Labs '

    const { useWorkspace } = await load()

    expect(useWorkspace().workspaceName.value).toBe('Northwind Labs')
    expect(request).not.toHaveBeenCalled()
  })

  it('tells every reader about a rename at once', async () => {
    window.suite_workspace_name = 'Northwind'
    const { useWorkspace } = await load()
    const reader = useWorkspace().workspaceName

    useWorkspace().setWorkspace({ workspace_name: ' Acme ', workspace_logo: '' })

    expect(reader.value).toBe('Acme')
  })
})
