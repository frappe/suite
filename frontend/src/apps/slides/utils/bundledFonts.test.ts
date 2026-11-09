import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { warmBundledFonts } from './bundledFonts'

const stylesheet = readFileSync(resolve(__dirname, '../styles/fonts.css'), 'utf8')
const fontFaces = stylesheet.split('@font-face').slice(1)
const SITE_ASSETS = resolve(__dirname, '../../../../../suite/public')

describe('the bundled slide fonts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'fonts')
  })

  it('warms every declared file without going through document.fonts', async () => {
    const load = vi.fn()
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
    const fetched: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url)
        return new Response('')
      }),
    )

    await warmBundledFonts()

    const declaredFiles = [...stylesheet.matchAll(/url\('([^']+)'\)/g)].map(([, url]) => url)
    expect(fetched).toHaveLength(fontFaces.length)
    expect(new Set(fetched)).toEqual(new Set(declaredFiles))
    expect(load).not.toHaveBeenCalled()
  })

  it('points every declared face at a file the site serves', () => {
    const paths = [...stylesheet.matchAll(/url\('\/assets\/suite\/([^']+)'\)/g)].map(
      ([, path]) => path,
    )

    expect(paths).toHaveLength(fontFaces.length)
    expect(paths.filter((path) => !existsSync(resolve(SITE_ASSETS, path)))).toEqual([])
  })
})
