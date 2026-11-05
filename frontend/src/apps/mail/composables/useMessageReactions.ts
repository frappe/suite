import { toast } from 'frappe-ui'
import { inject, reactive, type ComputedRef } from 'vue'

import { api, useMutation } from '@/api'
import type { Mail, MailReaction, UserResource } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'
import { useUndo } from '@/apps/mail/utils/composables'
import { hasReacted } from '@/apps/mail/utils/reactions'
import { undoSendPeriodOf } from '@/apps/mail/utils/undoSend'

/**
 * Reacting to the messages of one open conversation.
 *
 * What the reader just reacted with is held here until the thread comes back with it. A reaction is
 * a mail of its own, folded onto its target by the server (see collapse_reactions).
 *
 * Delivered mail can't be recalled, so the only way to take a reaction back is the Undo on the toast.
 * Unlike a sent mail, the wait is held here and not on the server: a reaction nothing has been told
 * about yet is not a pending send, so it doesn't bring the Outbox out to show it. Closing the page
 * during the wait drops the reaction, which is the cheaper way for this to fail.
 */
export function useMessageReactions(
  account: () => string,
  ownEmails: ComputedRef<Set<string>>,
  reload: () => void,
) {
  const user = inject<UserResource>('$user')
  const { setUndoAction, retireUndoAction } = useUndo()
  const send = useMutation(api.mail.messages.react)

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

  // As for a sent mail (see useComposeMail): Undo on the toast and in the ⌘Z slot for the same time,
  // whichever fires taking the other with it. It outlives the view, as the wait does.
  function react(mail: Mail, emoji: string) {
    if (mail.cannot_react) return void raiseToast(mail.cannot_react, 'error')
    if (hasReacted(reactionsOn(mail), emoji, ownEmails.value))
      return void raiseToast(__('You already reacted with {0}.', [emoji]))

    const from_email = [...ownEmails.value][0] ?? null
    sending.set(mail.id, [...(sending.get(mail.id) ?? []), { emoji, from_name: null, from_email }])

    const accountId = account()
    const windowMs = undoSendPeriodOf(user?.data) * 1000

    const deliver = async () => {
      retireUndoAction(undoNow)
      try {
        await send.run({ account: accountId, id: mail.id, emoji })
        reload()
      } catch (error) {
        stopShowing(mail, emoji)
        raiseToast(
          error instanceof Error && error.message
            ? error.message
            : __('Could not react to this message.'),
          'error',
        )
      }
    }
    const waiting = setTimeout(() => void deliver(), windowMs)

    const undoNow = () => {
      clearTimeout(waiting)
      toast.dismiss(shown)
      retireUndoAction(undoNow)
      stopShowing(mail, emoji)
    }
    setUndoAction(undoNow, { outlivesView: true })
    const shown = raiseToast(
      __('Reacted with {0}.', [emoji]),
      'success',
      { label: __('Undo'), onClick: undoNow },
      windowMs,
    )
  }

  return { reactionsOn, react }
}
