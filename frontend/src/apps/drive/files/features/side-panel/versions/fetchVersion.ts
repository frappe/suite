import type { DocumentSession } from '@/apps/drive'

/** The stored bytes of version `seq`. */
export async function fetchVersion(session: DocumentSession, seq: number): Promise<Uint8Array> {
  const response = await session.credentials.fetch(session.versions.contentUrl(String(seq)))
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return new Uint8Array(await response.arrayBuffer())
}
