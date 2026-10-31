// Vitest can warn and silently omit sources when an uncovered-file transform
// fails. Keep CI's denominator tied to production sources, not to that report.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const summary = JSON.parse(
  fs.readFileSync(path.join(root, 'test-results/coverage/coverage-summary.json'), 'utf8'),
)
const reported = new Set(
  Object.keys(summary).map((file) =>
    path.relative(root, file.replaceAll('\\', '/')).replaceAll('\\', '/'),
  ),
)
const eligible = ['src', 'recorder']
  .flatMap((directory) =>
    fs
      .readdirSync(path.join(root, directory), { recursive: true })
      .map((file) => `${directory}/${file.replaceAll('\\', '/')}`),
  )
  .filter(
    (file) =>
      (file.startsWith('src/') ? /\.(js|ts|vue)$/.test(file) : /\.(ts|vue)$/.test(file)) &&
      !/\.(test\.(js|ts)|d\.ts)$/.test(file) &&
      !/(^|\/)test-utils\.(js|ts)$/.test(file) &&
      !file.includes('/__fixtures__/') &&
      !file.startsWith('src/test/') &&
      // The recorder adapter and the IronCalc compatibility corpus are test-only.
      file !== 'recorder/frappeUi.ts' &&
      !file.startsWith('src/apps/sheets/core/ironcalc-gate/'),
  )
const missing = eligible.filter((file) => !reported.has(file)).sort()
if (missing.length) {
  console.error(`Coverage omitted ${missing.length} production sources:\n${missing.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Coverage includes all ${eligible.length} eligible production sources.`)
}
