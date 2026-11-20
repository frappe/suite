/** The file a preview showed last, by the path of the page that opened it, so that page focuses its row on return. */
const lastShown = new Map<string, string>()

export function rememberShown(openedFrom: string, node: string): void {
  lastShown.set(openedFrom, node)
}

/** The file last shown from `openedFrom`, once. */
export function takeShown(openedFrom: string): string | null {
  const node = lastShown.get(openedFrom) ?? null
  lastShown.delete(openedFrom)
  return node
}
