import { api, client } from '@/api'

export async function fetchLinkPreview(url) {
  if (!/^https?:\/\//i.test(url || '')) return { error: true }
  try {
    return await client.query(api.sheets.links.preview, { url }, { cache: 'prefer' })
  } catch {
    return { error: true }
  }
}
