// Older drawings also store the default ink as a literal.
export function displayInk(color?: string): string {
  return color === undefined || color.toLowerCase() === '#171717' ? 'var(--draw-ink)' : color
}
