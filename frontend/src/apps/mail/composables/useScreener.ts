import { computed, effectScope, reactive, ref, watch } from 'vue'

import { api, client } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import { raiseToast } from '@/apps/mail/utils'
import { useUndo } from '@/apps/mail/utils/composables'

/**
 * The Screener, folded into the Inbox. With screening on, the mail server delivers mail from a
 * first-time sender to the Inbox marked with the `unscreened` keyword, and the list shows it as from
 * an unknown sender. A screened thread is an ordinary thread: it opens in the normal thread view,
 * every action works, and acting on it decides it — reply, star or a move to any folder but Junk
 * (Trash included) allows its senders; Junk denies them. Either verdict takes the keyword off.
 *
 * A thread is decided as a whole: every sender it is waiting on goes the same way, the way the
 * thread itself does. The bar in an open thread can still say yes to one of them alone.
 */
// Bumped after every verdict, so mounted lists refresh without each subscribing to the API calls.
const version = ref(0)

// Domains anyone can sign up to. Trusting one would trust every stranger who writes from it, so they
// are never offered as a domain to trust.
const SHARED_MAIL_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'gmx.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'mail.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'rediffmail.com',
  'yahoo.co.in',
  'yahoo.com',
  'yandex.com',
  'zoho.com',
])

/** The '@domain' of each address worth offering to trust, in order, leaving out shared mail domains. */
export const trustableDomains = (emails: string[]) =>
  [...new Set(emails.map((email) => email.split('@').pop()?.toLowerCase() ?? ''))]
    .filter((domain) => domain && !SHARED_MAIL_DOMAINS.has(domain))
    .map((domain) => `@${domain}`)

type Destination = 'inbox' | 'archive' | 'trash'

/** A thread row, or one of its messages: whatever says whose mail is waiting. */
export type Screenable = {
  from_email?: string
  unscreened?: 0 | 1 | boolean
  /** A thread row's: the senders of its unscreened mail, in the order they first wrote. */
  unscreened_senders?: string[]
}

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

  // Senders decided here, by address or by '@domain'. The list and an open thread both read a sender
  // as decided at once, rather than when their copy of the mail is next fetched — which, for a thread
  // already open, can be never. An undo takes the sender back out.
  const decided = reactive(new Set<string>())
  const decide = (emails: string[]) => emails.forEach((email) => decided.add(email.toLowerCase()))
  const undecide = (emails: string[]) => emails.forEach((email) => decided.delete(email.toLowerCase()))
  watch(
    () => store.accountId,
    () => decided.clear(),
  )
  const isDecided = (email: string) => {
    const address = email.toLowerCase()
    return decided.has(address) || decided.has(`@${address.split('@').pop()}`)
  }

  /** The senders an item is still waiting on, undecided, in the order they first wrote. */
  const waitingSenders = (item?: Screenable): string[] => {
    if (!active.value || !item?.unscreened) return []
    const senders = item.unscreened_senders ?? (item.from_email ? [item.from_email] : [])
    return senders.filter((email) => !isDecided(email))
  }

  const isScreened = (item?: Screenable) => waitingSenders(item).length > 0

  const settled = () => {
    store.mailboxes.refetch().catch(() => {})
    version.value++
  }

  const undoFor = (emails: string[], decidedIds?: Record<string, string[]>) => ({
    label: __('Undo'),
    onClick: () => {
      undecide(emails)
      return client
        .mutation(api.mail.screener.undo, {
          account: store.accountId,
          from_emails: emails,
          ids: Object.values(decidedIds ?? {}).flat(),
        })
        .then(settled)
    },
  })

  /** Accepts the senders, and files everything of theirs that was waiting into `destination`. */
  const allow = async (
    emails: string[],
    destination: Destination = 'inbox',
    message: string = emails.length === 1
      ? __('Sender marked as trusted.')
      : __('Senders marked as trusted.'),
  ) => {
    decide(emails)
    try {
      const allowed = await client.mutation(api.mail.screener.allow, {
        account: store.accountId,
        from_emails: emails,
        destination,
      })
      raiseToast(message, 'success', undoFor(emails, allowed))
      return allowed
    } catch (error) {
      undecide(emails)
      raiseToast((error as Error).message || __('Action failed.'), 'error')
    } finally {
      settled()
    }
  }

  /** Marks the senders spam and moves everything of theirs that was waiting to Junk. */
  const deny = async (emails: string[]) => {
    decide(emails)
    try {
      const junked = await client.mutation(api.mail.screener.reject, {
        account: store.accountId,
        from_emails: emails,
      })
      raiseToast(
        emails.length === 1
          ? __('Future mail from sender will go to Junk.')
          : __('Future mail from these senders will go to Junk.'),
        'success',
        undoFor(emails, junked),
      )
    } catch (error) {
      undecide(emails)
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

  const sendersOf = (items: Screenable[]) => [...new Set(items.flatMap(waitingSenders))]

  /**
   * Accept every sender the threads an action just touched are waiting on — moving one anywhere but
   * Junk, or filing it into a folder, is a decision to let its senders in. Raises no toast of its
   * own: the action's toast says what happened, and its Undo takes the acceptance back too. Call it
   * right after the action arms that undo.
   */
  const acceptOnAction = (items: Screenable[]) => {
    const emails = sendersOf(items)
    if (emails.length) prependUndoAction(acceptSenders(emails))
  }

  /**
   * The same for an action that has no undo or toast of its own — a star, a reply: one toast says the
   * senders are trusted, and its Undo (or `z`) reverts the action with `revert`, if there is one, and
   * takes the acceptance back.
   */
  const acceptWithUndo = (items: Screenable[], revert?: () => void) => {
    const emails = sendersOf(items)
    if (!emails.length) return
    const reverse = acceptSenders(emails)
    setUndoAction(() => {
      revert?.()
      reverse()
    })
    raiseToast(
      emails.length === 1 ? __('Sender marked as trusted.') : __('Senders marked as trusted.'),
      'success',
      { label: __('Undo'), onClick: undo },
    )
  }

  return {
    active,
    version,
    acceptOnAction,
    acceptWithUndo,
    waitingSenders,
    isScreened,
    allow,
    deny,
  }
}
