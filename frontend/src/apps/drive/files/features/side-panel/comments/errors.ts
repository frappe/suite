import { toast } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'
import { TransportError } from '@/platform/transport'

/** Tells the person what went wrong: the error's own message, else `fallback`. */
export function showError(error: unknown, fallback: string) {
  if (error instanceof TransportError && error.type !== 'NetworkError') {
    toast.error(__(error.message))
    return
  }

  toast.error(fallback)
}
