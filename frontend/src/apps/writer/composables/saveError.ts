import { reportMutationError } from '@/platform/feedback'

/** Event and debounce boundaries retain the dirty draft and report refused saves. */
export function reportSaveError(error: unknown): void {
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
    return
  reportMutationError(error instanceof Error ? error : new Error(String(error)))
}
