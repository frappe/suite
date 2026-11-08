// Exercise Suite's vendored plugin through Oxlint, including configured severities.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('lint rejects discarded type evidence and reducer copies, while permitting boundary validation', () => {
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
    assert.deepEqual(errors.sort(), [
      'anti-slop(no-reduce-accumulator-copy)',
      'anti-slop(no-widen-then-assert)',
    ])
    const valid = lint('valid.ts')
    assert.equal(valid.status, 0, valid.stderr)
    assert.deepEqual(JSON.parse(valid.stdout).diagnostics, [])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
