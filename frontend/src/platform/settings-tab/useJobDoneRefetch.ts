import type { Socket } from 'socket.io-client'
import { onScopeDispose } from 'vue'

export type JobOperation = 'Import' | 'Export'

/**
 * Keeps the read of a running import or export job current, for `SettingsJobStatus`: the read
 * runs again when the product's socket sends `event` for a job of this `operation`. Call it in a
 * component setup; the listener goes when the component unmounts.
 */
export function useJobDoneRefetch(
  read: { refetch(): Promise<unknown> },
  { socket, event, operation }: { socket: Socket; event: string; operation: JobOperation },
): void {
  const onDone = (payload: { action: JobOperation }) => {
    if (payload.action === operation) read.refetch().catch(() => {})
  }
  socket.on(event, onDone)
  onScopeDispose(() => socket.off(event, onDone))
}
