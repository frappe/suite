/**
 * Flags the server sends in the SPA boot (`suite/www/suite.py`), each from one
 * site config key. The client reads them from boot only, so a key change
 * applies on the next page load [T014, T018].
 */
export type BootFlag = 'suite_flip_shell' | 'suite_flip_files'

/** Whether the boot carries `flag` as on. A missing boot reads as off. */
export function readBootFlag(flag: BootFlag): boolean {
  return typeof window !== 'undefined' && window[flag] === true
}
