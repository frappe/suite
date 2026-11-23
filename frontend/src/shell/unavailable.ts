import type { PlatformCapability } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

export interface UnavailableCopy {
  title: string
  reason: string
  nextStep: string
}

/** What an area's page says when the account lacks a capability the area requires. */
export function describeUnavailable(
  areaLabel: string,
  missing: readonly PlatformCapability[],
  isMailServerConfigured: boolean,
): UnavailableCopy {
  const title = `${areaLabel} ${__('is unavailable')}`
  if (!missing.includes('jmap')) {
    return {
      title,
      reason: __('Your account does not have the capability required for this area.'),
      nextStep: __('Ask a site administrator to review your access.'),
    }
  }
  return isMailServerConfigured
    ? {
        title,
        reason: __("You don't have a Mail account."),
        nextStep: __('Ask your admin to add one.'),
      }
    : {
        title,
        reason: __('This area needs a configured mail account.'),
        nextStep: __('Ask a site administrator to configure mail, then reload this page.'),
      }
}
