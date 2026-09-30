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
