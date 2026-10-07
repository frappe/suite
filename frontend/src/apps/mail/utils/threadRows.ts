import { api, type OutputOf } from '@/api'
import type { Attachment, Mail, Thread } from '@/apps/mail/types'

type WireMessage = OutputOf<typeof api.mail.threads.get>[number]
type WireThread = OutputOf<typeof api.mail.threads.list>['rows'][number]
type SearchRow = OutputOf<typeof api.mail.messages.search>['rows'][number]
function attachmentRow(value: WireMessage['attachments'][number]): Attachment {
  return {
    ...value,
    filename: value.filename ?? '',
    disposition: value.disposition ?? '',
    file_url: value.url,
  }
}
export function mailRow(row: WireMessage): Mail {
  return {
    ...row,
    message_id: row.message_id ?? '',
    from_name: row.from_name ?? '',
    subject: row.subject ?? '',
    html_body: row.html_body ?? '',
    text_body: row.text_body ?? '',
    mailboxes: row.mailboxes.map((mailbox) => ({
      ...mailbox,
      mailbox_name: mailbox.mailbox_name ?? '',
    })),
    recipients: row.recipients.map((recipient) => ({ ...recipient })),
    reply_to: row.reply_to.map((address) => ({
      ...address,
      display_name: address.display_name ?? '',
    })),
    attachments: row.attachments.map(attachmentRow),
    duplicates: row.duplicates?.map((copy) => ({
      ...copy,
      from_name: copy.from_name ?? '',
      mailboxes: copy.mailboxes.map((mailbox) => ({
        ...mailbox,
        mailbox_name: mailbox.mailbox_name ?? '',
      })),
    })),
    user_image: row.user_image ?? undefined,
  }
}
export function threadRow(row: WireThread | SearchRow, account: string): Thread {
  return {
    ...row,
    account: row.account ?? account,
    account_name: row.account_name,
    inbox: row.inbox ?? undefined,
    archive: row.archive ?? undefined,
    trash: row.trash ?? undefined,
    from_name: row.from_name ?? '',
    messages: 'messages' in row ? row.messages.map(mailRow) : [],
    mailboxes: row.mailboxes.map((mailbox) => ({
      ...mailbox,
      mailbox_name: mailbox.mailbox_name ?? '',
    })),
    attachments: row.attachments.map(attachmentRow),
    recipients: row.recipients.map((recipient) => ({ ...recipient })),
    user_image: row.user_image ?? undefined,
    draft: 'draft' in row ? row.draft : 0,
    junk: 'junk' in row ? row.junk : 0,
    flagged: 'flagged' in row ? row.flagged : 0,
  }
}
