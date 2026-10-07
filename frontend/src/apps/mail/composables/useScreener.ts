import { computed, effectScope, reactive, ref, watch } from 'vue'

import { api, client, type InputOf } from '@/api'
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

/** A mail as it was before a Junk took it: its folders and junk state, for an Undo to put back. */
export type SavedMail = InputOf<typeof api.mail.messages.setFolders>['mails'][number]

/** A thread row, or one of its messages: whatever says whose mail is waiting. */
export type Screenable = {
  /** The owning account, when the item says. A thread row does; a message in an open pane doesn't. */
  account?: string
  from_email?: string
  unscreened?: 0 | 1 | boolean
  /** A thread row's: the senders of its unscreened mail, in the order they first wrote. */
  unscreened_senders?: string[]
}

// Built once in a detached scope, so every caller shares the one version counter and watchers.
let shared: ReturnType<typeof createShared> | undefined

export const useScreener = () => (shared ??= effectScope(true).run(createShared)!)

/**
 * Every call acts on one account, the active one unless it is given. All Inboxes opens another
 * account's thread without switching to it, and a decision there belongs to that account: its rules,
 * its mail, its Undo.
 */
const createShared = () => {
  const store = userStore()

  const { prependUndoAction, setUndoAction, undo } = useUndo()

  const accountOf = (account?: string) =>
    store.userResource?.data?.accounts?.find((a) => a.id === (account ?? store.accountId))

  const isActive = (account?: string) => !!accountOf(account)?.enable_screening
  const active = computed(() => isActive())

  // Senders decided here, by address or by '@domain', per account. The list and an open thread both
  // read a sender as decided at once, rather than when their copy of the mail is next fetched —
  // which, for a thread already open, can be never. An undo takes the sender back out.
  const decided = reactive(new Set<string>())
  const keyOf = (account: string, email: string) => `${account}\n${email.toLowerCase()}`
  const decide = (account: string, emails: string[]) =>
    emails.forEach((email) => decided.add(keyOf(account, email)))
  const undecide = (account: string, emails: string[]) =>
    emails.forEach((email) => decided.delete(keyOf(account, email)))
  watch(
    () => store.accountId,
    () => decided.clear(),
  )
  const isDecided = (account: string, email: string) =>
    decided.has(keyOf(account, email)) || decided.has(keyOf(account, `@${email.split('@').pop()}`))

  /** The senders an item is still waiting on, undecided, in the order they first wrote. */
  const waitingSenders = (item?: Screenable, account?: string): string[] => {
    const owner = account ?? item?.account ?? store.accountId
    if (!isActive(owner) || !item?.unscreened) return []
    const senders = item.unscreened_senders ?? (item.from_email ? [item.from_email] : [])
    return senders.filter((email) => !isDecided(owner, email))
  }

  const isScreened = (item?: Screenable, account?: string) =>
    waitingSenders(item, account).length > 0

  const settled = () => {
    store.mailboxes.refetch().catch(() => {})
    version.value++
  }

  const failed = (error: unknown) =>
    raiseToast((error as Error).message || __('Action failed.'), 'error')

  // Takes a verdict back: the rules it wrote go, and `ids` — the mail it decided — wait again.
  const reverseVerdict = (account: string, emails: string[], ids: string[]) => {
    undecide(account, emails)
    return client
      .mutation(api.mail.screener.undo, { account, from_emails: emails, ids })
      .then(settled)
  }

  /** Accepts the senders, and files everything of theirs that was waiting into `destination`. */
  const allow = async (
    emails: string[],
    {
      account = store.accountId,
      destination = 'inbox',
      message = emails.length === 1 ? __('Sender marked as trusted.') : __('Senders marked as trusted.'),
    }: { account?: string; destination?: Destination; message?: string } = {},
  ) => {
    decide(account, emails)
    try {
      const allowed = await client.mutation(api.mail.screener.allow, {
        account,
        from_emails: emails,
        destination,
      })
      raiseToast(message, 'success', {
        label: __('Undo'),
        onClick: () => reverseVerdict(account, emails, Object.values(allowed).flat()),
      })
      return allowed
    } catch (error) {
      undecide(account, emails)
      failed(error)
    } finally {
      settled()
    }
  }

  /** The rest of blocked senders' mail in the Inbox goes to Junk too — their other folders are left
   * alone — with an Undo of its own, which also runs `alsoUndo` when there is one. */
  const junkOldMail = async (
    emails: string[],
    account = store.accountId,
    alsoUndo?: () => void,
  ) => {
    let moved: string[]
    try {
      moved = await client.mutation(api.mail.screening.junkInbox, { account, from_emails: emails })
    } catch (error) {
      failed(error)
      return
    }
    setUndoAction(() => {
      alsoUndo?.()
      void client
        .mutation(api.mail.messages.spam, { account, ids: moved, spam: false })
        .then(settled)
    })
    settled()
    raiseToast(
      moved.length === 1
        ? __('1 more moved to Junk.')
        : __('{0} more moved to Junk.', [String(moved.length)]),
      'success',
      { label: __('Undo'), onClick: undo },
    )
  }

  // The question a block asks about the senders' old mail in the Inbox, while it is open (see
  // OldMailDialog). Asked only when the account's setting says to ask.
  const oldMailPrompt = ref<{ account: string; emails: string[]; count: number } | null>(null)

  /** Saves what to do with a blocked sender's old mail from now on, so the question is not asked. */
  const rememberOldMailChoice = (choice: 'Move to Junk' | 'Keep', account = store.accountId) =>
    client
      .mutation(api.mail.settings.updateAccount, {
        account,
        changes: { on_block_old_mail: choice },
      })
      .then(() => store.userResource.refetch())
      .catch(failed)

  /**
   * What every block does after it lands — Block Sender, No on the new-sender bar, Junk on a screened
   * thread: the toast says the senders are blocked, with `revert` as its Undo. When they have
   * `oldMail` left in the Inbox, the account's setting says what becomes of it: moved to Junk, kept,
   * or — by default — asked about.
   */
  const raiseBlocked = (
    emails: string[],
    revert: () => void,
    oldMail: number,
    account = store.accountId,
  ) => {
    setUndoAction(revert)
    raiseToast(
      emails.length === 1
        ? __('Sender blocked. Future mail will go to Junk.')
        : __('Senders blocked. Future mail will go to Junk.'),
      'success',
      { label: __('Undo'), onClick: undo },
    )
    if (!oldMail) return
    const setting = accountOf(account)?.on_block_old_mail
    // Done without asking, it is part of the block: one Undo takes back both.
    if (setting === 'Move to Junk') void junkOldMail(emails, account, revert)
    else if (setting !== 'Keep') oldMailPrompt.value = { account, emails, count: oldMail }
  }

  /**
   * Marks the senders spam and moves everything of theirs that was waiting to Junk, along with
   * `mails` — the rest of what is being junked with them, saved as it was so Undo puts it back
   * exactly. Says whether it landed.
   */
  const deny = async (
    emails: string[],
    { account = store.accountId, mails = [] }: { account?: string; mails?: SavedMail[] } = {},
  ) => {
    decide(account, emails)
    try {
      const junked = Object.values(
        await client.mutation(api.mail.screener.reject, { account, from_emails: emails }),
      ).flat()
      const rest = mails.filter((mail) => !junked.includes(mail.id))
      // The rule is in place already, so this only junks the rest of the thread, and counts what
      // else of theirs is in the Inbox — mail from before screening, say.
      const { inbox } = await client
        .mutation(api.mail.screening.block, {
          account,
          from_emails: emails,
          ids: rest.map((mail) => mail.id),
        })
        .catch((error) => {
          failed(error)
          return { inbox: 0 }
        })
      raiseBlocked(
        emails,
        () => {
          void reverseVerdict(account, emails, junked)
          if (rest.length)
            void client
              .mutation(api.mail.messages.setFolders, { account, mails: rest })
              .then(settled)
        },
        inbox,
        account,
      )
      return true
    } catch (error) {
      undecide(account, emails)
      failed(error)
      return false
    } finally {
      settled()
    }
  }

  // Accepts the senders in the background once `landed` — whether the action that decided them did —
  // says it has, and not at all if it failed. Returns what takes the acceptance back.
  const acceptSenders = (
    emails: string[],
    account = store.accountId,
    landed: Promise<boolean> = Promise.resolve(true),
  ) => {
    decide(account, emails)
    const accepted = landed
      .then((ok) =>
        ok
          ? client.mutation(api.mail.screener.allow, {
              account,
              from_emails: emails,
              destination: 'inbox',
            })
          : undefined,
      )
      .then(
        (ids) => {
          if (!ids) undecide(account, emails)
          return ids
        },
        (error) => {
          undecide(account, emails)
          failed(error)
          return undefined
        },
      )
      .finally(settled)
    return () =>
      accepted
        .then((ids) => {
          undecide(account, emails)
          // Nothing was accepted, so there is nothing to take back.
          if (ids) return reverseVerdict(account, emails, Object.values(ids).flat())
        })
        .catch(failed)
  }

  const sendersOf = (items: Screenable[], account?: string) => [
    ...new Set(items.flatMap((item) => waitingSenders(item, account))),
  ]

  /**
   * Accept every sender the threads an action just touched are waiting on — moving one anywhere but
   * Junk, or filing it into a folder, is a decision to let its senders in. `landed` says whether the
   * action's request went through: the senders are accepted once it has, and not if it failed. Raises no toast of its
   * own: the action's toast says what happened, and its Undo takes the acceptance back first, then
   * undoes the action — the other way round, the acceptance's undo would put back in the Inbox what
   * the action's had just put back where it was. Call it right after the action arms that undo.
   */
  const acceptOnAction = (items: Screenable[], landed?: Promise<boolean>, account?: string) => {
    const emails = sendersOf(items, account)
    if (emails.length && landed)
      prependUndoAction(acceptSenders(emails, account ?? items[0]?.account, landed))
  }

  /**
   * The same for an action that has no undo or toast of its own — a star, a reply: one toast says the
   * senders are trusted, and its Undo (or `z`) reverts the action with `revert`, if there is one, and
   * takes the acceptance back.
   */
  const acceptWithUndo = (items: Screenable[], revert?: () => void, account?: string) => {
    const emails = sendersOf(items, account)
    if (!emails.length) return
    const reverse = acceptSenders(emails, account ?? items[0]?.account)
    setUndoAction(() => {
      revert?.()
      void reverse()
    })
    raiseToast(
      emails.length === 1 ? __('Sender marked as trusted.') : __('Senders marked as trusted.'),
      'success',
      { label: __('Undo'), onClick: undo },
    )
  }

  return {
    active,
    isActive,
    version,
    acceptOnAction,
    acceptWithUndo,
    sendersOf,
    waitingSenders,
    isScreened,
    allow,
    deny,
    raiseBlocked,
    oldMailPrompt,
    junkOldMail,
    rememberOldMailChoice,
  }
}
