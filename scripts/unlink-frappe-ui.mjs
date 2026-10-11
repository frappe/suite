// Restore the PUBLISHED frappe-ui. If node_modules/frappe-ui is a symlink to the
// local checkout (created by `pnpm dev:frappe-ui`), remove it and reinstall the
// package from the lockfile. This runs before plain `pnpm dev`, so switching
// back from local-frappe-ui work is automatic. No-op (and cheap) when nothing
// is linked. pnpm always installs node_modules/frappe-ui as a symlink into its
// store, so only a link that points at the checkout counts as "linked".
import { execSync } from 'node:child_process'
import { lstatSync, readlinkSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(appRoot, 'frappe-ui')
const linkPath = resolve(appRoot, 'node_modules/frappe-ui')
const stat = lstatSync(linkPath, { throwIfNoEntry: false })

if (stat?.isSymbolicLink() && resolve(dirname(linkPath), readlinkSync(linkPath)) === checkout) {
  console.log('↩  Unlinking local frappe-ui; restoring the published package…')
  // unlinkSync removes the symlink itself; never follows it into the checkout.
  unlinkSync(linkPath)
  // Relink the published frappe-ui from the lockfile.
  execSync('pnpm install --frozen-lockfile', { cwd: appRoot, stdio: 'inherit' })
  console.log('✓ frappe-ui restored from the registry')
}
