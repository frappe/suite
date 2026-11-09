import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadBundledFonts } from './bundledFonts'

const stylesheet = readFileSync(resolve(__dirname, '../styles/fonts.css'), 'utf8')
const fontFaces = stylesheet.split('@font-face').slice(1)
const SITE_ASSETS = resolve(__dirname, '../../../../../suite/public')

function declared(rule: string, property: string) {
  return new RegExp(`${property}:\\s*'?([^;']+)`).exec(rule)?.[1]
}

async function facesTheLoaderAsksFor() {
  const load = vi.fn(async (_face: string, _sample: string) => [])
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
  await loadBundledFonts()
  return load.mock.calls.map(([face]) => face)
}

describe('the bundled slide fonts', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'fonts')
  })

  // document.fonts.load finds nothing and still resolves for a face no @font-face declares
  it('has a declared face for every font the loader asks the browser for', async () => {
    const faces = await facesTheLoaderAsksFor()

    expect(faces.length).toBeGreaterThan(0)
    for (const face of faces) {
      const style = face.startsWith('italic') ? 'italic' : 'normal'
      const weight = /\b(\d00)\b/.exec(face)?.[1]
      const family = /16px "?([^"]+)"?$/.exec(face)?.[1]
      const matching = fontFaces.filter(
        (rule) =>
          declared(rule, 'font-family') === family &&
          declared(rule, 'font-weight') === weight &&
          declared(rule, 'font-style') === style,
      )

      expect(matching, face).not.toEqual([])
    }
  })

  it('points every declared face at a file the site serves', () => {
    const paths = [...stylesheet.matchAll(/url\('\/assets\/suite\/([^']+)'\)/g)].map(
      ([, path]) => path,
    )

    expect(paths).toHaveLength(fontFaces.length)
    expect(paths.filter((path) => !existsSync(resolve(SITE_ASSETS, path)))).toEqual([])
  })
})
