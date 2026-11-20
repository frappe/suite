/** Files above this size are not loaded into the text preview, so a large file cannot freeze the tab. */
export const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024

export type TextContent =
  | { status: 'ready'; text: string }
  /** Over `TEXT_PREVIEW_LIMIT`. Nothing was fetched when the size said so. */
  | { status: 'too-large' }
  /** The bytes are not UTF-8 text. */
  | { status: 'unreadable' }
  | { status: 'failed' }

/**
 * Fetches a file's bytes as text. The bytes become a string and nothing else:
 * no HTML is parsed and no script runs, whatever the file holds.
 */
export async function loadTextContent(
  url: string,
  size: number,
  signal?: AbortSignal,
): Promise<TextContent> {
  if (size > TEXT_PREVIEW_LIMIT) return { status: 'too-large' }
  // An empty file has no bytes on the server to fetch.
  if (size === 0) return { status: 'ready', text: '' }
  let bytes: ArrayBuffer
  try {
    const response = await fetch(url, { credentials: 'same-origin', signal })
    if (!response.ok) return { status: 'failed' }
    bytes = await response.arrayBuffer()
  } catch (error) {
    if (signal?.aborted) throw error
    return { status: 'failed' }
  }
  // The recorded size can be out of date when a new version lands meanwhile.
  if (bytes.byteLength > TEXT_PREVIEW_LIMIT) return { status: 'too-large' }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    // A NUL byte is valid UTF-8 but marks binary data, not text.
    return text.includes('\0') ? { status: 'unreadable' } : { status: 'ready', text }
  } catch {
    return { status: 'unreadable' }
  }
}
