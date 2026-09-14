export function slugify(title: string): string {
  const normalized = title.normalize('NFKC').toLocaleLowerCase()
  const slug = normalized
    .replace(/[^\p{Letter}\p{Mark}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return Array.from(slug).slice(0, 80).join('').replace(/-+$/g, '')
}
