export interface WindowResult {
  rows: readonly unknown[]
  hasNext: boolean
  fetchNext(): Promise<WindowResult>
}

/** Skip access-filtered empty cursor windows without treating a short page as the end. */
export async function loadUntilVisible(result: WindowResult): Promise<WindowResult> {
  let current = result
  let count = current.rows.length
  while (current.hasNext) {
    current = await current.fetchNext()
    if (current.rows.length > count) return current
    count = current.rows.length
  }
  return current
}

