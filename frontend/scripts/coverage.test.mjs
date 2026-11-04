// Exercise uncovered-file transformation through the real Vitest configuration.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('coverage retains untested TypeScript and Vue sources with package subpaths and icons', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-coverage-'))
  const sources = [
    'src/apps/mail/composables/useComposeMail.ts',
    'src/apps/meet/composables/useSFUConnection.ts',
    'src/apps/meet/components/ChatPanel.vue',
    'src/shell/SetupView.vue',
  ]
  try {
    const result = spawnSync(
      'yarn',
      [
        'vitest',
        'run',
        '--config',
        'vitest.config.ts',
        '--passWithNoTests=false',
        '--project',
        'unified',
        'src/platform/random-id/index.test.ts',
        '--coverage',
        '--coverage.reporter=json-summary',
        `--coverage.reportsDirectory=${directory}`,
        ...sources.map((source) => `--coverage.include=${source}`),
      ],
      { cwd: root, encoding: 'utf8', timeout: 120_000 },
    )
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const summary = JSON.parse(
      fs.readFileSync(path.join(directory, 'coverage-summary.json'), 'utf8'),
    )
    for (const source of sources) {
      const coverage = summary[path.join(root, source)]
      assert.ok(coverage, `Untested source missing from coverage: ${source}\n${result.stderr}`)
      assert.ok(coverage.lines.total > 0, `${source} must contribute executable lines`)
      assert.equal(coverage.lines.covered, 0, `${source} was never imported by this test`)
    }
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /Excluding it from coverage|Failed to resolve import/,
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('the CI completeness check matches POSIX and Windows report paths and rejects missing sources', () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'suite-coverage-check-')))
  try {
    for (const folder of [
      'scripts',
      'src/test',
      'src/__fixtures__',
      'recorder',
      'test-results/coverage',
    ]) {
      fs.mkdirSync(path.join(directory, folder), { recursive: true })
    }
    fs.copyFileSync(
      path.join(root, 'scripts/check-coverage.mjs'),
      path.join(directory, 'scripts/check-coverage.mjs'),
    )
    for (const file of [
      'src/unused.ts',
      'src/Unused.vue',
      'src/unused.test.ts',
      'src/types.d.ts',
      'src/test/boundary.ts',
      'src/__fixtures__/fixture.ts',
      'recorder/frappeUi.ts',
    ]) {
      fs.writeFileSync(path.join(directory, file), '')
    }
    const report = path.join(directory, 'test-results/coverage/coverage-summary.json')
    const check = () =>
      spawnSync(process.execPath, [path.join(directory, 'scripts/check-coverage.mjs')], {
        encoding: 'utf8',
      })
    fs.writeFileSync(report, JSON.stringify({ total: {} }))
    let result = check()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Coverage omitted 2 production sources:/)
    assert.match(result.stderr, /src\/unused\.ts/)
    assert.match(result.stderr, /src\/Unused\.vue/)

    for (const separator of ['/', '\\']) {
      const tsPath = path.join(directory, 'src/unused.ts').replaceAll(path.sep, separator)
      const vuePath = path.join(directory, 'src/Unused.vue').replaceAll(path.sep, separator)
      fs.writeFileSync(report, JSON.stringify({ total: {}, [tsPath]: {} }))
      result = check()
      assert.equal(result.status, 1)
      assert.equal(result.stderr.trim(), 'Coverage omitted 1 production sources:\nsrc/Unused.vue')

      fs.writeFileSync(report, JSON.stringify({ total: {}, [tsPath]: {}, [vuePath]: {} }))
      result = check()
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /Coverage includes all 2 eligible production sources/)
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
