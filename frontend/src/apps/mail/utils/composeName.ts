import type { ComposeMailData } from '@/apps/mail/types'

/**
 * What a composer is for, as its title says: a reply or a forward says so rather than calling itself
 * a new message. A draft reopened from Drafts arrives without its reply type, so the mail it answers
 * or forwards is what tells.
 */
export const composeName = (mail?: ComposeMailData) => {
  const kind =
    mail?.type ?? (mail?.forwarded_from_id ? 'forward' : mail?.in_reply_to ? 'reply' : undefined)
  if (kind === 'forward') return __('Forward')
  if (kind === 'replyAll') return __('Reply all')
  if (kind === 'reply') return __('Reply')
  return __('New message')
}
