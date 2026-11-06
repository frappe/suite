// @vitest-environment node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// The server's Node children, built fresh and run as the server runs them
// (suite/content/checker.py `node_command`): allowed to read only themselves, so a
// bundle that splits into chunks or reaches for browser UI fails here first.
const FRONTEND = path.resolve(__dirname, '../../../..')
const VITE = path.join(
  path.dirname(createRequire(import.meta.url).resolve('vite/package.json')),
  'bin/vite.js',
)
const BUILD_LIMIT_MS = 180_000
const built: string[] = []

afterAll(() => {
  for (const folder of built) {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

function build(mode: 'checker' | 'converter') {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `writer-${mode}-`))
  built.push(outDir)
  const child = spawnSync(
    process.execPath,
    [
      VITE,
      'build',
      '--config',
      'vite.checker.config.ts',
      '--mode',
      mode,
      '--outDir',
      outDir,
      '--sourcemap',
    ],
    { cwd: FRONTEND, encoding: 'utf8', timeout: BUILD_LIMIT_MS },
  )
  if (child.status !== 0) throw new Error(`build exit ${child.status}: ${child.stderr}`)
  return outDir
}

// checker.py `framed`: each part after its length in 4 little-endian bytes
function framed(parts: Uint8Array[]) {
  return Buffer.concat(
    parts.flatMap((part) => {
      const length = Buffer.alloc(4)
      length.writeUInt32LE(part.length)
      return [length, Buffer.from(part)]
    }),
  )
}

function run(bundle: string, header: object, ...rest: Uint8Array[]) {
  const child = spawnSync(
    process.execPath,
    ['--permission', `--allow-fs-read=${bundle}`, '--expose-gc', bundle],
    { input: framed([Buffer.from(JSON.stringify(header)), ...rest]), env: {}, timeout: 60_000 },
  )
  if (child.status !== 0) throw new Error(`exit ${child.status}: ${child.stderr.toString()}`)
  return JSON.parse(child.stdout.toString()) as Record<string, unknown>
}

function bundledSources(outDir: string, bundle: string) {
  const map = JSON.parse(fs.readFileSync(path.join(outDir, `${bundle}.map`), 'utf8')) as {
    sources: string[]
  }
  return map.sources
}

function codeFiles(outDir: string) {
  return fs.readdirSync(outDir, { recursive: true, encoding: 'utf8' }).filter((file) => {
    return !file.endsWith('.map') && fs.statSync(path.join(outDir, file)).isFile()
  })
}

const BROWSER_UI =
  /apps\/drive\/files\/|DriveBrowser|FolderPicker|MentionMenu|platform\/server-state/

describe('Writer server bundles under --permission', () => {
  it(
    'the converter is one file with no Drive UI, and converts',
    { timeout: BUILD_LIMIT_MS },
    () => {
      const outDir = build('converter')
      const bundle = path.join(outDir, 'converter.cjs')

      const answer = run(bundle, {
        legacy: { content: null, html: '<p>Hello</p>', collab: 0, ycomments: null },
        maxState: 10_000_000,
      })

      expect(codeFiles(outDir)).toEqual(['converter.cjs'])
      expect(
        bundledSources(outDir, 'converter.cjs').filter((file) => BROWSER_UI.test(file)),
      ).toEqual([])
      expect(answer).toMatchObject({ kind: 'converted' })
      expect(run(bundle, {})).toEqual({ version: expect.any(String) })
    },
  )

  it('the checker is one file with no Drive UI, and judges', { timeout: BUILD_LIMIT_MS }, () => {
    const outDir = build('checker')
    const bundle = path.join(outDir, 'checker.cjs')

    const answer = run(bundle, { mode: 'judge' }, new Uint8Array())

    expect(codeFiles(outDir)).toEqual(['checker.cjs'])
    expect(bundledSources(outDir, 'checker.cjs').filter((file) => BROWSER_UI.test(file))).toEqual(
      [],
    )
    expect(answer).toMatchObject({ verdict: 'clean', yjs: expect.any(String) })
  })
})
