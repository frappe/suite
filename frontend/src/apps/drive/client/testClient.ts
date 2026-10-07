/** Tests replace only the transport boundary; owner policy and the API engine stay real. */
import { afterEach } from 'vitest'

import { createApiClient } from '@/platform/server-state'
import type { Transport } from '@/platform/transport'

const clients: Array<ReturnType<typeof createApiClient>> = []
export function testClient(transport: Transport) {
  const engine = createApiClient(
    { drive: () => import('./policy').then((module) => module.registration) },
    { transport, persistence: false, feedback: () => {} },
  )
  clients.push(engine)
  return engine.client
}
afterEach(() => {
  for (const engine of clients.splice(0)) engine.dispose()
})
