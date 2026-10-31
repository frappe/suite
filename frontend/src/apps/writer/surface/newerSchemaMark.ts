const PREFIX = 'suite:writer-newer-schema:'
// One value per page load, so a reload reads the mark an earlier load left
const PAGE_LOAD = String(Date.now() + Math.random())

/**
 * Marks that this tab showed the newer-schema banner for the document.
 * True when an earlier load of the tab showed it too; false where the browser blocks this storage.
 */
export function markNewerSchemaShown(node: string) {
  const key = `${PREFIX}${node}`
  try {
    const earlier = sessionStorage.getItem(key)
    sessionStorage.setItem(key, PAGE_LOAD)
    return earlier !== null && earlier !== PAGE_LOAD
  } catch {
    return false
  }
}
