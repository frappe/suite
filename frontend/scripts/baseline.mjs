// A shrinking count baseline, shared by lint.mjs, check-untranslated.mjs and
// typecheck.mjs. Each check keeps a JSON object of key -> count under
// `baselines/`; a key is a file, or `file|rule`. The check fails when a key
// gains findings or appears without an entry, and also when a key has fewer
// findings than its entry, so a fix must shrink the baseline in the same
// change. `--update-baseline` rewrites the file from the current findings.
// Owners: the product folder that contains the file. Removal: the entry goes
// when the file is clean.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const updating = process.argv.includes('--update-baseline')

/**
 * Compares findings to the baseline in `baselines/<name>` and reports.
 * `actual` maps a key to one detail line per finding. With `files` (relative
 * paths), only baseline entries for those files take part, for a check that
 * ran on a subset of the tree; `--update-baseline` needs a whole-tree run and
 * is refused otherwise. Returns true when the check failed.
 */
export function compareBaseline(label, actual, name, files) {
  const file = path.join(frontendRoot, 'baselines', name)
  const counts = new Map([...actual].map(([key, details]) => [key, details.length]))
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)

  if (updating && files) {
    console.error(`--update-baseline needs a run over the whole tree, not a file list.`)
    return true
  }
  if (updating) {
    const sorted = Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`)
    console.log(
      `Wrote ${path.relative(frontendRoot, file)}: ${counts.size} entries, ${total} ${label} findings.`,
    )
    return false
  }

  const baseline = fs.existsSync(file)
    ? new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))))
    : new Map()
  if (files) {
    const checked = new Set(files)
    for (const key of baseline.keys()) {
      if (!checked.has(key.split('|')[0])) baseline.delete(key)
    }
  }

  const grown = [...counts].filter(([key, count]) => count > (baseline.get(key) ?? 0))
  const shrunk = [...baseline].filter(([key, count]) => (counts.get(key) ?? 0) < count)
  if (!grown.length && !shrunk.length) {
    console.log(
      `${capitalise(label)} passed (${total} baselined findings in ${counts.size} entries).`,
    )
    return false
  }

  if (grown.length) {
    console.error(`New ${label} findings:`)
    for (const [key, count] of grown.sort()) {
      const allowed = baseline.get(key) ?? 0
      console.error(`  ${key}: ${count} (baseline ${allowed})`)
      for (const detail of actual.get(key)) console.error(`    ${detail}`)
    }
  }
  if (shrunk.length) {
    console.error(`Resolved ${label} debt still in the baseline:`)
    for (const [key, count] of shrunk.sort()) {
      console.error(`  ${key}: ${counts.get(key) ?? 0} (baseline ${count})`)
    }
    console.error(
      `Shrink it with: node scripts/${path.basename(process.argv[1])} --update-baseline`,
    )
  }
  return true
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
