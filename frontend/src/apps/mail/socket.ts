import { inject } from 'vue'

import { createSiteSocket } from '@/realtime'

export const initSocket = () => createSiteSocket()

export function useMailSocket(): ReturnType<typeof initSocket> {
  const socket = inject<ReturnType<typeof initSocket>>('$socket')
  if (!socket) throw new Error('Mail socket is unavailable outside the Mail layout')
  return socket
}
