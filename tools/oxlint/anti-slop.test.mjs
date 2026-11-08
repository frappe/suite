// Exercise Suite's vendored plugin through Oxlint, including configured severities.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('lint enforces selected anti-slop rules while permitting boundary validation', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'suite-anti-slop-'))
  try {
    const config = JSON.parse(readFileSync(path.join(root, '.oxlintrc.json'), 'utf8'))
    config.options.typeAware = false
    config.jsPlugins[0].specifier = path.join(root, 'tools/oxlint/anti-slop/index.ts')
    writeFileSync(path.join(directory, 'config.json'), JSON.stringify(config))
    writeFileSync(
      path.join(directory, 'invalid.ts'),
      `
const known = { id: 'one' }
const erased: unknown = known
const restored = erased as { id: string }
const copied = [1, 2].reduce((acc, value) => Object.assign({}, acc, { [value]: value }), {})
const chained = (known as unknown) as { id: string }
const transformed = [1, 2].filter(value => value > 1).map(value => value * 2)
const omitted = { ...(true ? { enabled: true } : {}) }
function inspect(input: object) { return String(input) }
const property = Reflect.get(known, 'id')
const result = Reflect.apply(inspect, null, [known])
`,
    )
    writeFileSync(
      path.join(directory, 'valid.ts'),
      `
function isName(value: unknown): value is string {
  return typeof value === 'string'
}
const literal = 'ready' as const
`,
    )
    const lint = (file) =>
      spawnSync(
        path.join(root, 'node_modules/.bin/oxlint'),
        [
          '--config',
          path.join(directory, 'config.json'),
          '--format',
          'json',
          path.join(directory, file),
        ],
        { cwd: root, encoding: 'utf8' },
      )
    const invalid = lint('invalid.ts')
    assert.equal(invalid.status, 1, invalid.stderr)
    const errors = JSON.parse(invalid.stdout)
      .diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.code)
    assert.deepEqual([...new Set(errors)].sort(), [
      'anti-slop(no-array-filter-map)',
      'anti-slop(no-chained-type-assertions)',
      'anti-slop(no-conditional-empty-object-spread)',
      'anti-slop(no-known-value-widening)',
      'anti-slop(no-object-parameters)',
      'anti-slop(no-reduce-accumulator-copy)',
      'anti-slop(no-reflect-apply)',
      'anti-slop(no-reflect-get)',
      'anti-slop(no-widen-then-assert)',
      'anti-slop(require-safety-comment-for-type-assertion)',
    ])
    const valid = lint('valid.ts')
    assert.equal(valid.status, 0, valid.stderr)
    assert.deepEqual(JSON.parse(valid.stdout).diagnostics, [])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
