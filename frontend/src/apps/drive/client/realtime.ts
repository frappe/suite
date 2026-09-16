import { invalidateAll, type ReadDescriptor } from '@/platform/server-state'
import { subscribe } from '@/platform/realtime'

let observers = 0
let unsubscribe: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null

export function observeDriveChanges(): () => void {
  observers += 1
  if (!unsubscribe) {
    unsubscribe = subscribe('drive:changed', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => invalidateAll(isDriveQuery), 150)
    })
  }
  return () => {
    observers = Math.max(0, observers - 1)
    if (observers) return
    unsubscribe?.()
    unsubscribe = null
    if (timer) clearTimeout(timer)
    timer = null
  }
}

function isDriveQuery(descriptor: ReadDescriptor): boolean {
  return descriptor.operation.owner === 'drive'
}
