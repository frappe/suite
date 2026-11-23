import { inject } from 'vue'

import { createSiteSocket } from '@/realtime'

// Reconnects without a cap: the lists hear of new mail through it, and a laptop lid outlasts five
// attempts.
export const initSocket = () => createSiteSocket({ reconnectionAttempts: Infinity })

export function useMailSocket(): ReturnType<typeof initSocket> {
  const socket = inject<ReturnType<typeof initSocket>>('$socket')
  if (!socket) throw new Error('Mail socket is unavailable outside the Mail layout')
  return socket
}
