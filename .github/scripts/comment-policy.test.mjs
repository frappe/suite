import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./comment-policy.mjs', import.meta.url))

function repository(t, files) {
  const cwd = mkdtempSync(join(tmpdir(), 'suite-comments-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' })
  const write = (path, content) => writeFileSync(join(cwd, path), content)
  git('init', '--quiet')
  for (const [path, content] of Object.entries(files)) write(path, content)
  git('add', '.')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'baseline')
  const run = (mode, ...args) =>
    spawnSync(process.execPath, [script, mode, ...args], {
      cwd,
      encoding: 'utf8',
    })
  return { git, write, run }
}

test('inventory identifies comments in source and embedded blocks without counting literals', (t) => {
  const repo = repository(t, {
    'example.ts': 'const url = "https://example.org"\nconst pat = /[//]/\n// JS comment\n',
    'example.py': 'text = """\n# inside a string\n"""\nx = 1  # inline Python\n',
    'example.vue':
      '<!-- component -->\n<template><div><!-- template --></div></template>\n' +
      '<script setup lang="ts">const n: number = 1 // Vue script\n</script>\n' +
      '<style>.a { color: /* Vue style */ red; }</style>\n',
    'example.html': '<!-- HTML --><script>const text = "<!-- literal -->"; // embedded\n</script>',
  })

  const result = repo.run('inventory')
  assert.equal(result.status, 0, result.stderr)
  const comments = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.deepEqual(
    comments.map(({ path, start, text, standalone }) => [path, start, text, standalone]),
    [
      ['example.html', 1, '<!-- HTML -->', false],
      ['example.html', 1, '// embedded', false],
      ['example.py', 4, '# inline Python', false],
      ['example.ts', 3, '// JS comment', true],
      ['example.vue', 1, '<!-- component -->', true],
      ['example.vue', 2, '<!-- template -->', false],
      ['example.vue', 3, '// Vue script', false],
      ['example.vue', 5, '/* Vue style */', false],
    ],
  )
})

test('ratchet accepts deletions and line shifts but rejects duplicates and copies', (t) => {
  const repo = repository(t, {
    'a.ts': '// remove me\n// existing\nexport const a = 1\n',
    'b.py': 'b = 1\n',
  })
  repo.write('a.ts', '\n// existing\nexport const a = 1\n')
  assert.equal(repo.run('check').status, 0)

  repo.write('a.ts', '// existing\n// existing\nexport const a = 1\n')
  repo.write('b.py', 'b = 1  # new\n')
  repo.write('new.ts', '// existing\nexport const c = 1\n')
  repo.git('add', 'new.ts')
  const result = repo.run('check', 'HEAD')
  assert.equal(result.status, 1)
  assert.deepEqual(result.stderr.trim().split('\n'), [
    'a.ts:2: new code comment',
    'b.py:1: new code comment',
    'new.ts:1: new code comment',
  ])
})

test('ratchet checks commits since the base and retires deleted allowances', (t) => {
  const repo = repository(t, { 'example.ts': '// old\nexport const value = 1\n' })
  repo.git('branch', 'base')
  repo.write('example.ts', 'export const value = 1\n')
  repo.git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-qam',
    'delete comment',
  )
  assert.equal(repo.run('check', 'base').status, 0)
  repo.write('example.ts', '// old\nexport const value = 1\n')
  repo.git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-qam',
    'restore comment',
  )
  const result = repo.run('check', 'HEAD^')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /example\.ts:1: new code comment/)
})

test('ratchet allows interpreter and TypeScript safety comments', (t) => {
  const repo = repository(t, { 'script.py': 'print(1)\n', 'lookup.ts': 'export const value = 1\n' })
  repo.write('script.py', '#!/usr/bin/env python3\nprint(1)\n')
  repo.write(
    'lookup.ts',
    '// SAFETY: A is a member of this union.\nexport const value = "A" as "A" | "B"\n',
  )
  const result = repo.run('check')
  assert.equal(result.status, 0, result.stderr)
})
