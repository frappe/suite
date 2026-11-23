import { api, client } from '@/api'

export async function recordVisit(node: string): Promise<void> {
  await client.mutation(api.drive.nodes.visit, { node }, { silent: true })
}
