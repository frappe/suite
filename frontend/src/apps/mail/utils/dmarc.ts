import type { api, OutputOf } from '@/api'
// What the DMARC pages share: the shapes Suite's admin API answers and how a result reads.

import type { BadgeTheme } from '@/apps/mail/utils/reports'

export type DmarcTotals = OutputOf<typeof api.mail.admin.dmarc.summary>['totals']
export type DmarcReportRow = OutputOf<typeof api.mail.admin.dmarc.list>['items'][number]
export type DmarcSummary = OutputOf<typeof api.mail.admin.dmarc.summary>
export type DmarcPolicy = OutputOf<typeof api.mail.admin.dmarc.get>['policy']
export type DmarcRecord = OutputOf<typeof api.mail.admin.dmarc.get>['records'][number]

// An aligned DKIM or SPF check as the reporter evaluated it.
export const resultBadge = (result?: string | null): { label: string; theme: BadgeTheme } => {
  const value = (result || '').toLowerCase()
  if (value === 'pass') return { label: __('Pass'), theme: 'green' }
  if (value === 'fail') return { label: __('Fail'), theme: 'red' }
  return { label: result || __('None'), theme: 'gray' }
}

// What the receiver did with the messages once the check was evaluated: delivered is the good
// outcome, so it reads green; quarantined and rejected escalate through orange to red.
export const dispositionBadge = (
  disposition?: string | null,
): { label: string; theme: BadgeTheme } => {
  const value = (disposition || '').toLowerCase()
  if (value === 'reject') return { label: __('Rejected'), theme: 'red' }
  if (value === 'quarantine') return { label: __('Quarantined'), theme: 'amber' }
  // Some reporters still write the pre-standard "pass" for a message they delivered.
  if (value === 'none' || value === 'pass' || !value)
    return { label: __('Delivered'), theme: 'green' }
  return { label: disposition as string, theme: 'gray' }
}
