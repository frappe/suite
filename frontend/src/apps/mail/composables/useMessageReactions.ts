import { toast } from 'frappe-ui'
import { reactive } from 'vue'

import { api, useMutation } from '@/api'
import type { Mail, MailReaction } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'
import { useOwnEmails, useUndo } from '@/apps/mail/utils/composables'
import { hasReacted } from '@/apps/mail/utils/reactions'
import { undoSendPeriodOf } from '@/apps/mail/utils/undoSend'

/**
 * Reacting to the messages of one open conversation.
 *
 * A message can be reacted to from its header, from its chips, and, for the newest, from beside
 * Forward, so what the reader just sent is held here for all of them, until the thread comes back
 * with it. A reaction is a mail of its own, folded onto its target by the server (see
 * collapse_reactions). Delivered mail can't be recalled, so the only way to take one back is the
 * Undo on the toast, while the server still holds it.
 */
export function useMessageReactions(account: () => string, reload: () => void) {
  const ownEmails = useOwnEmails()
  const { setUndoAction, retireUndoAction } = useUndo()
  const send = useMutation(api.mail.messages.react)
  const undo = useMutation(api.mail.scheduled.undoReaction)

  const sending = reactive(new Map<string, MailReaction[]>())

  const reactionsOn = (mail: Mail): MailReaction[] => [
    ...(mail.reactions ?? []),
    ...(sending.get(mail.id) ?? []).filter(
      (reaction) => !hasReacted(mail.reactions, reaction.emoji, ownEmails.value),
    ),
  ]

  const stopShowing = (mail: Mail, emoji: string) =>
    sending.set(
      mail.id,
      (sending.get(mail.id) ?? []).filter((reaction) => reaction.emoji !== emoji),
    )

  async function react(mail: Mail, emoji: string) {
    if (hasReacted(reactionsOn(mail), emoji, ownEmails.value))
      return raiseToast(__('You already reacted with {0}.', [emoji]))

    const from_email = [...ownEmails.value][0] ?? null
    sending.set(mail.id, [...(sending.get(mail.id) ?? []), { emoji, from_name: null, from_email }])
    try {
      const result = await send.run({ account: account(), id: mail.id, emoji })
      reload()
      if (result.submission_id)
        offerUndo(mail, emoji, result.submission_id, result.undo_send_period)
    } catch {
      stopShowing(mail, emoji)
      raiseToast(__('Could not react to this message.'), 'error')
    }
  }

  // As for a sent mail (see useComposeMail): Undo on the toast and in the ⌘Z slot for as long as the
  // server holds delivery, whichever fires taking the other with it.
  function offerUndo(mail: Mail, emoji: string, submissionId: string, period?: number | null) {
    const accountId = account()
    const windowMs = (period ?? undoSendPeriodOf()) * 1000
    const undoNow = () => {
      toast.dismiss(sentToast)
      retireUndoAction(undoNow)
      stopShowing(mail, emoji)
      undo
        .run({ account: accountId, id: submissionId })
        .then(() => {
          reload()
          raiseToast(__('Reaction removed.'))
        })
        .catch(() =>
          raiseToast(__('It was already delivered, so it can’t be taken back.'), 'error'),
        )
    }
    setUndoAction(undoNow, { outlivesView: true })
    setTimeout(() => retireUndoAction(undoNow), windowMs)
    const sentToast = raiseToast(
      __('Reacted with {0}.', [emoji]),
      'success',
      { label: __('Undo'), onClick: undoNow },
      windowMs,
    )
  }

  return { reactionsOn, react }
}
