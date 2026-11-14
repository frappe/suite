import { toast } from 'frappe-ui'

/** Tells the person what went wrong: the error's own message, else `fallback`. */
export function showError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    toast.error(error.message)
    return
  }

  toast.error(fallback)
}
