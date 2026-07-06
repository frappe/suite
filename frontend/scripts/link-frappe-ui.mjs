// Symlink node_modules/frappe-ui -> the local ../frappe-ui checkout so EVERY
// resolver consumes one copy: Vite (JS), Node (Tailwind's config loader,
// frappe-ui/vite plugin), and vue-tsc all follow the same files. This replaces
// the old Vite-alias approach, which only covered the Vite door and left
// Node-loaded tooling (Tailwind preset, etc.) resolving the published package.
//
// Run via `yarn dev:frappe-ui`. Idempotent. `yarn dev` (or `yarn install`)
// restores the published package, so switching back is automatic.
import { lstatSync, readlinkSync, rmSync, symlinkSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(frontendDir, '../frappe-ui')
const linkPath = resolve(frontendDir, 'node_modules/frappe-ui')
const relTarget = relative(dirname(linkPath), checkout)

/** lstat without throwing on a missing path (returns null instead). */
function lstatOrNull(p) {
  return lstatSync(p, { throwIfNoEntry: false }) ?? null
}

if (!existsSync(checkout)) {
  console.error(`✗ No local frappe-ui checkout at ${checkout}`)
  console.error('  Clone/checkout frappe-ui there, or use `yarn dev` for the published package.')
  process.exit(1)
}

const stat = lstatOrNull(linkPath)
if (stat?.isSymbolicLink() && resolve(dirname(linkPath), readlinkSync(linkPath)) === checkout) {
  console.log('✓ frappe-ui already linked to local checkout')
  process.exit(0)
}

// Replace whatever is there — a published install dir or a stale link. A
// symlink must be removed with unlinkSync (never recurse into the checkout it
// points at); a real install dir is a reinstallable artifact, safe to rm -rf.
if (stat?.isSymbolicLink()) unlinkSync(linkPath)
else if (stat) rmSync(linkPath, { recursive: true, force: true })
symlinkSync(relTarget, linkPath)
console.log(`✓ Linked node_modules/frappe-ui -> ${relTarget} (local checkout)`)
