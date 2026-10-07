import { computed, effectScope, reactive, ref, watch } from 'vue'

import { api, client } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import { raiseToast } from '@/apps/mail/utils'
import { useUndo } from '@/apps/mail/utils/composables'

/**
 * The Screener, folded into the Inbox. With screening on, the mail server delivers mail from a
 * first-time sender to the Inbox marked with the `unscreened` keyword, and the list shows it as from
 * a New sender. A screened thread is an ordinary thread: it opens in the normal thread view, every
 * action works, and acting on it decides the sender — reply, star or a move to any folder but Junk
 * (Trash included) allows them; Junk denies them. Either verdict takes the keyword off.
 */
// Bumped after every verdict, so mounted lists refresh without each subscribing to the API calls.
const version = ref(0)

type Destination = 'inbox' | 'archive' | 'trash'

// Built once in a detached scope, so every caller shares the one version counter and watchers.
let shared: ReturnType<typeof createShared> | undefined

export const useScreener = () => (shared ??= effectScope(true).run(createShared)!)

const createShared = () => {
  const store = userStore()

  const { prependUndoAction, setUndoAction, undo } = useUndo()

  const active = computed(
    () =>
      !!store.userResource?.data?.accounts?.find((a) => a.id === store.accountId)?.enable_screening,
  )

  /** Mail from a sender nobody has decided on yet: the server marks it with the `unscreened` keyword. */
  // Senders decided here, by address. The list and an open thread both read a sender as decided at
  // once, rather than when their copy of the mail is next fetched — which, for a thread already
  // open, can be never. An undo takes the sender back out.
  const decided = reactive(new Set<string>())
  const decide = (emails: string[]) => emails.forEach((email) => decided.add(email.toLowerCase()))
  const undecide = (emails: string[]) => emails.forEach((email) => decided.delete(email.toLowerCase()))
  watch(
    () => store.accountId,
    () => decided.clear(),
  )

  const isScreened = (item?: { from_email?: string; unscreened?: 0 | 1 | boolean }) =>
    !!item?.unscreened && !decided.has((item.from_email ?? '').toLowerCase())

  const settled = () => {
    store.mailboxes.refetch().catch(() => {})
    version.value++
  }

  const undoFor = (fromEmail: string, moved?: Record<string, string[]>) => ({
    label: __('Undo'),
    onClick: () => {
      undecide([fromEmail])
      return client
        .mutation(api.mail.screener.undo, {
          account: store.accountId,
          from_emails: [fromEmail],
          ids: moved?.[fromEmail] ?? [],
        })
        .then(settled)
    },
  })

  /** Accepts the sender and files everything of theirs waiting in the Screener into `destination`. */
  const allow = async (fromEmail: string, destination: Destination = 'inbox', message?: string) => {
    decide([fromEmail])
    try {
      const moved = await client.mutation(api.mail.screener.allow, {
        account: store.accountId,
        from_emails: [fromEmail],
        destination,
      })
      raiseToast(message ?? __('Sender marked as trusted.'), 'success', undoFor(fromEmail, moved))
      return moved
    } catch (error) {
      undecide([fromEmail])
      raiseToast((error as Error).message || __('Action failed.'), 'error')
    } finally {
      settled()
    }
  }

  /** Marks the sender spam and moves everything of theirs waiting in the Screener to Junk. */
  const deny = async (fromEmail: string, message?: string) => {
    decide([fromEmail])
    try {
      const junked = await client.mutation(api.mail.screener.reject, {
        account: store.accountId,
        from_emails: [fromEmail],
      })
      raiseToast(
        message ?? __('Future mail from sender will go to Junk.'),
        'success',
        undoFor(fromEmail, junked),
      )
    } catch (error) {
      undecide([fromEmail])
      raiseToast((error as Error).message || __('Action failed.'), 'error')
    } finally {
      settled()
    }
  }

  // Accepts the senders in the background; returns what takes the acceptance back.
  const acceptSenders = (emails: string[]) => {
    const account = store.accountId
    decide(emails)
    const accepted = client
      .mutation(api.mail.screener.allow, { account, from_emails: emails, destination: 'inbox' })
      .then((ids) => {
        settled()
        return ids
      })
      .catch((error) => {
        undecide(emails)
        raiseToast((error as Error).message || __('Action failed.'), 'error')
        return undefined
      })
    return () => {
      undecide(emails)
      return accepted
        .then((ids) => {
          // Nothing was accepted, so there is nothing to take back.
          if (!ids) return
          return client
            .mutation(api.mail.screener.undo, {
              account,
              from_emails: emails,
              ids: Object.values(ids).flat(),
            })
            .then(settled)
        })
        .catch((error) => raiseToast((error as Error).message || __('Action failed.'), 'error'))
    }
  }

  const sendersOf = (threads: { from_email: string; unscreened?: 0 | 1 | boolean }[]) =>
    active.value ? [...new Set(threads.filter(isScreened).map((thread) => thread.from_email))] : []

  /**
   * Accept the senders of the screened threads an action just touched — moving one anywhere but
   * Junk, or filing it into a folder, is a decision to let its sender in. Raises no toast of its
   * own: the action's toast says what happened, and its Undo takes the acceptance back too. Call it
   * right after the action arms that undo.
   */
  const acceptOnAction = (threads: { from_email: string; unscreened?: 0 | 1 | boolean }[]) => {
    const emails = sendersOf(threads)
    if (emails.length) prependUndoAction(acceptSenders(emails))
  }

  /**
   * The same for an action that has no undo or toast of its own — a star: one toast says both, and
   * its Undo (or `z`) reverts the action with `revert` and takes the acceptance back.
   */
  const acceptWithUndo = (
    threads: { from_email: string; from_name?: string; unscreened?: 0 | 1 | boolean }[],
    message: (sender: string) => string,
    revert: () => void,
  ) => {
    const emails = sendersOf(threads)
    if (!emails.length) return
    const reverse = acceptSenders(emails)
    setUndoAction(() => {
      revert()
      reverse()
    })
    const first = threads.find(isScreened)
    const who = emails.length === 1 ? first?.from_name || emails[0] : String(emails.length)
    raiseToast(message(who), 'success', {
      label: __('Undo'),
      onClick: undo,
    })
  }

  return {
    active,
    version,
    acceptOnAction,
    acceptWithUndo,
    isScreened,
    allow,
    deny,
  }
}
