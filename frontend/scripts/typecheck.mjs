import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { compareBaseline, frontendRoot } from './baseline.mjs'

// Type-checks the unified frontend: the folders `tsconfig.typecheck.json`
// includes. The compiler also reads every legacy file those folders import,
// and reports errors there too. Any error inside the included folders fails
// the check. Errors outside them are counted per file against the shrinking
// baseline in `baselines/typecheck.json`, so legacy code can move to strict
// types one file at a time and never gain an error unnoticed.

const configName = 'tsconfig.typecheck.json'
const config = JSON.parse(fs.readFileSync(path.join(frontendRoot, configName), 'utf8'))

// "src/apps/*/surface/**/*.vue" -> /^src\/apps\/[^/]+\/surface\//
const scope = config.include.map((pattern) => {
  const folder = pattern.split('/**')[0]
  const source = folder
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+')
  return new RegExp(`^${source}${pattern.includes('/**') ? '/' : '$'}`)
})

// The whole program no longer fits in Node's default 2 GB heap.
const run = spawnSync('yarn', ['--silent', 'vue-tsc', '-p', configName, '--pretty', 'false'], {
  cwd: frontendRoot,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  env: {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim(),
  },
})
if (run.error) throw run.error

// The compiler exits 0 when it reports nothing, and 1 or 2 when it reports
// diagnostics. Anything else means it did not finish: a signal, a crash, or
// a tool error. Its partial output proves nothing, so the check fails even
// when every error it printed was outside the scope.
if (run.signal) abort(`vue-tsc was terminated by ${run.signal}.`)
if (![0, 1, 2].includes(run.status)) abort(`vue-tsc exited with status ${run.status}.`)

// Each error starts on an unindented line; its detail lines are indented.
const errors = []
for (const line of `${run.stdout}${run.stderr}`.split('\n')) {
  if (!line.trim()) continue
  if (/^\s/.test(line) && errors.length) errors[errors.length - 1].push(line)
  else errors.push([line])
}

const diagnostic = /^(.+?)\(\d+,\d+\): error TS\d+:/
if (run.status !== 0 && !errors.some((error) => diagnostic.test(error[0]))) {
  abort(`vue-tsc exited with status ${run.status} and printed no diagnostics.`)
}

const fileOf = (error) => error[0].match(diagnostic)?.[1]?.replaceAll('\\', '/')
// Output that is not a file diagnostic (a config error, say) is always in scope.
const inScope = []
const outside = new Map()
for (const error of errors) {
  const file = fileOf(error)
  // Syntax errors stop semantic checking for the entire program. Never baseline them.
  if (!file || /: error TS1\d{3}:/.test(error[0]) || scope.some((pattern) => pattern.test(file))) {
    inScope.push(error)
    continue
  }
  if (!outside.has(file)) outside.set(file, [])
  outside.get(file).push(error[0])
}

if (inScope.length) {
  console.error(inScope.map((error) => error.join('\n')).join('\n'))
  console.error(`\nTypecheck failed: ${inScope.length} errors in scope.`)
  process.exit(1)
}
console.log('Typecheck passed (0 errors in scope).')
if (compareBaseline('out-of-scope type error', outside, 'typecheck.json')) process.exit(1)

// Fails the check when vue-tsc did not finish, with the end of what it printed.
function abort(message) {
  const output = `${run.stdout}${run.stderr}`.trim()
  if (output) console.error(output.split('\n').slice(-20).join('\n'))
  console.error(`\nTypecheck failed: ${message}`)
  process.exit(1)
}
