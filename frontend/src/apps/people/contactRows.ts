import { api, type OutputOf } from '@/api'
import { extractNameFromEmail } from '@/apps/people/utils'

type ContactRow = OutputOf<typeof api.mail.contacts.list>['rows'][number]
export function contactRow(row: ContactRow) {
  const address = row.emails[0]?.address ?? ''
  return {
    ...row,
    full_name: row.full_name || extractNameFromEmail(address),
    email: row.emails.length > 1 ? __('{0} + {1} more', [address, row.emails.length - 1]) : address,
  }
}
