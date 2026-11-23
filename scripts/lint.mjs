// Runs ESLint (`eslint.config.js`) over the frontend. Errors are compared to
// the shrinking baseline in `baselines/eslint.json`, keyed `file|rule`, so
// legacy code can be brought in line one file at a time while new errors fail.
// Warnings never fail the check; the editor shows them and `--fix` clears the
// fixable ones. `--fix` applies autofixes before comparing.
//
// File arguments (relative to the current directory, as pre-commit passes
// them) lint only those files and compare only their baseline entries.

import path from 'node:path'
import process from 'node:process'
import { ESLint } from 'eslint'

import { appRoot, compareBaseline } from './baseline.mjs'

const fix = process.argv.includes('--fix')
const files = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith('--'))
  .map((arg) => relativeToApp(path.resolve(arg)))

const eslint = new ESLint({ cwd: appRoot, fix })
const results = await eslint.lintFiles(
  files.length ? files : ['frontend', 'scripts', '*.js', '*.ts'],
)
if (fix) await ESLint.outputFixes(results)

const errors = new Map()
let warnings = 0
for (const result of results) {
  const file = relativeToApp(result.filePath)
  for (const message of result.messages) {
    if (message.severity !== 2) {
      warnings += 1
      continue
    }
    const key = `${file}|${message.ruleId ?? 'parse'}`
    const detail = `${file}:${message.line}:${message.column} ${message.message}`
    if (!errors.has(key)) errors.set(key, [])
    errors.get(key).push(detail)
  }
}

if (warnings) console.log(`${warnings} ESLint warnings (not enforced).`)
const failed = compareBaseline(
  'ESLint error',
  errors,
  'eslint.json',
  files.length ? files : undefined,
)
if (failed) process.exitCode = 1

function relativeToApp(absolute) {
  return path.relative(appRoot, absolute).replaceAll('\\', '/')
}
