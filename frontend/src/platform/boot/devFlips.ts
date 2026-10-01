// No imports: `vite.config.ts` loads this file under the Node tsconfig.
type SiteConfig = Record<string, unknown>

/** The `BootFlag` keys in `./index.ts`. */
type BootFlag = 'suite_flip_shell' | 'suite_flip_files'

/** Same rule as `flip_is_on` in `suite/suite_core/flips.py`: only 1, true, "1" or "true" turn a flip on. */
function flipIsOn(value: unknown): boolean {
  if (typeof value === 'string') return ['1', 'true'].includes(value.trim().toLowerCase())
  return value === true || value === 1
}

/**
 * The flip flags the server boot would send for a site. The site config
 * overrides the common config, as in Frappe. The Vite dev server uses this,
 * because frappe-ui injects the server boot only into the production build.
 */
export function devBootFlags(common: SiteConfig, site: SiteConfig): Record<BootFlag, boolean> {
  const config = { ...common, ...site }
  return {
    suite_flip_shell: flipIsOn(config.suite_flip_shell),
    suite_flip_files: flipIsOn(config.suite_flip_files),
  }
}
