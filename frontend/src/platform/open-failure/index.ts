import { translate } from '@/platform/translation'
import { isTransientStatus, MIN_SERVER_ERROR_STATUS } from '@/platform/transport'

// What to tell a person when a request failed before the server could answer it properly; null for any other status
export function describeFailure(status: number | null): string | null {
  if (status === null) {
    return null
  }

  if (status === 0) {
    return translate("Couldn't reach the server. Check your connection and try again.")
  }

  if (isTransientStatus(status)) {
    return translate('The server is busy. Try again in a moment.')
  }

  if (status >= MIN_SERVER_ERROR_STATUS) {
    return translate('The server had a problem opening this document. Try again in a moment.')
  }

  return null
}
