import { api, client, type OutputOf } from '@/api'

export type LinkPreview = OutputOf<typeof api.sheets.links.preview>

export async function fetchLinkPreview(url: string | null | undefined): Promise<LinkPreview> {
  if (!url || !/^https?:\/\//i.test(url)) return { error: true }
  try {
    return await client.query(api.sheets.links.preview, { url }, { cache: 'prefer' })
  } catch {
    return { error: true }
  }
}
