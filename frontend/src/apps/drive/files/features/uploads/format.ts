const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** A byte count as people read it: `0 B`, `12.4 MB`. Base 1024, like the storage settings. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${UNITS[unit]}`
}

/**
 * A size inside a sentence: `1 GB`, `1.2 GB`. Whole units drop the `.0`.
 * `roundUp` keeps a file just over a limit from reading as the limit itself.
 * `_readable_size` in `suite/drive/_core/upload.py` words the server's copy
 * of the same refusal this way.
 */
export function formatSize(bytes: number, { roundUp = false }: { roundUp?: boolean } = {}): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const scale = unit === 0 || value >= 100 ? 1 : 10
  // The epsilon keeps float noise (1.2 * 10 is 12.000000000000002) from rounding up.
  const rounded = (roundUp ? Math.ceil(value * scale - 1e-9) : Math.round(value * scale)) / scale
  return `${rounded} ${UNITS[unit]}`
}
