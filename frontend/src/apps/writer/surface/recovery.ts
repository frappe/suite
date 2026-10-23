/**
 * Writer's local recovery copy: the editor HTML kept on this device when
 * unsaved work cannot reach the server. It is never replayed automatically.
 * The person takes it out as an HTML file. It is removed once downloaded, or
 * once the document saves again with edit access, because it is then stale.
 */
export interface RecoveryCopy {
  savedAt: string
  html: string
}

const key = (node: string) => `suite:writer-recovery:${node}`

export function keepRecovery(node: string, html: string, now = new Date()): RecoveryCopy {
  const copy = { savedAt: now.toISOString(), html }
  localStorage.setItem(key(node), JSON.stringify(copy))
  return copy
}

export function readRecovery(node: string): RecoveryCopy | null {
  try {
    const copy = JSON.parse(
      localStorage.getItem(key(node)) ?? 'null',
    ) as Partial<RecoveryCopy> | null
    return typeof copy?.html === 'string' && typeof copy.savedAt === 'string'
      ? { savedAt: copy.savedAt, html: copy.html }
      : null
  } catch {
    return null
  }
}

export function clearRecovery(node: string): void {
  localStorage.removeItem(key(node))
}

/** The copy as a standalone HTML document, named after the document title. */
export function recoveryFile(copy: RecoveryCopy, title: string): File {
  const name = title.replace(/[<>:"/\\|?*]/g, '').trim() || 'Document'
  const page = [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${escapeText(title)}</title>`,
    `<meta name="recovered-at" content="${escapeText(copy.savedAt)}">`,
    '</head><body>',
    copy.html,
    '</body></html>',
  ].join('\n')
  return new File([page], `${name} (recovered).html`, { type: 'text/html' })
}

/** Save the document's recovery copy through the browser, then remove it. False when none is kept. */
export function downloadRecovery(node: string, title: string): boolean {
  const copy = readRecovery(node)
  if (!copy) return false
  const file = recoveryFile(copy, title)
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  clearRecovery(node)
  return true
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
