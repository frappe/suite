import { toast } from 'frappe-ui'
import { readonly, ref } from 'vue'

import type { ComposeMailData } from '@/apps/mail/types'
import {
  heldDraftCopyKeys,
  holdDraftCopy,
  listDraftCopies,
  pickDraftCopyMail,
  removeDraftCopy,
  writeDraftCopy,
  type DraftCopy,
  type DraftCopyMail,
} from '@/apps/mail/utils/draftCopies'

// More than this at once is a wall of toasts. The rest are offered on the next start.
const MAX_OFFERS = 3
const offers = new Map<string, ReturnType<typeof toast.warning>>()

const withdrawOffer = (key: string) => {
  const offer = offers.get(key)
  if (offer === undefined) return
  offers.delete(key)
  toast.dismiss(offer)
}

/**
 * One composition's copy on this device, for while the server can't take it (see DraftCopy). While
 * the composer runs the copy is its own, not one for another tab to offer back.
 *
 * `place` is read on every call: a composition kept as a new draft changes key, and a draft first
 * saved changes account from the scope's to the one it was saved in.
 */
export const createDraftCopy = (place: () => { user?: string; account: string; key: string }) => {
  // Blocked or full storage keeps nothing, which is what leaving warns about.
  const isKept = ref(false)
  let release: (() => void) | undefined
  const letGo = () => {
    release?.()
    release = undefined
  }
  return {
    isKept: readonly(isKept),
    keep({ mail, ids, uploading }: { mail: DraftCopyMail; ids: string[]; uploading: string[] }) {
      const { user, account, key } = place()
      if (!user) return
      isKept.value = writeDraftCopy({
        key,
        user,
        account,
        ids,
        savedAt: Date.now(),
        uploading,
        mail: pickDraftCopyMail(mail),
      })
      if (isKept.value) release ??= holdDraftCopy(key)
    },
    /** The server has everything, or nothing is left to keep: no copy, and no offer of one. */
    drop() {
      const { user, account, key } = place()
      if (user) removeDraftCopy(user, account, key)
      withdrawOffer(key)
      isKept.value = false
      letGo()
    },
    /** The composer is done. What it kept stays, for whoever comes back to it. */
    release: letGo,
  }
}

/**
 * The copies an earlier page left behind: ones no live composer, here or in another tab, still
 * answers for. Newest first.
 */
const listUnclaimedCopies = async (user: string) => {
  const copies = listDraftCopies(user)
  if (!copies.length) return []
  const held = await heldDraftCopyKeys()
  return copies.filter((copy) => !held.has(copy.key))
}

/** The copy left behind of a draft opened by id, under any id it has had. */
export const findUnclaimedCopy = async (user: string, account: string, id: string) =>
  (await listUnclaimedCopies(user)).find(
    (copy) => copy.account === account && copy.ids.includes(id),
  )

/** A copy left behind has been dealt with: restored, ignored or discarded. It is neither kept nor offered. */
export const discardDraftCopy = (copy: DraftCopy) => {
  withdrawOffer(copy.key)
  removeDraftCopy(copy.user, copy.account, copy.key)
}

/**
 * Reopens as what it was. It goes out on top of the id it was written on, so it can't overwrite
 * anything newer: if the draft has moved on since, or been sent or deleted, that id is gone from the
 * server and the save says so (see `gone` in draftSaver). Nothing is applied until then.
 */
export const draftFromCopy = (copy: DraftCopy): ComposeMailData => ({
  ...copy.mail,
  id: copy.ids[0],
  draft_key: copy.key,
  account: copy.account,
  composed: true,
  restored: true,
})

/**
 * Offer back what an earlier page left behind: the local copies of drafts that never reached the
 * server, in accounts this person still has.
 */
export const offerDraftCopies = async ({
  user,
  accounts,
  reopen,
}: {
  user: string
  accounts: string[]
  reopen: (draft: ComposeMailData) => void
}) => {
  // Asked again when the layout mounts again: a copy already on offer has its toast up.
  const fresh = (await listUnclaimedCopies(user)).filter(
    (copy) => accounts.includes(copy.account) && !offers.has(copy.key),
  )
  for (const copy of fresh.slice(0, Math.max(0, MAX_OFFERS - offers.size))) {
    const subject = copy.mail.subject?.trim() || __('No subject')
    const offer = toast.warning(__('A draft was not saved: {0}', [subject]), {
      description: copy.uploading.length
        ? __('Kept on this device, apart from files still uploading: {0}', [
            copy.uploading.join(', '),
          ])
        : __('Kept on this device'),
      duration: Infinity,
      action: {
        label: __('Reopen'),
        onClick: () => {
          offers.delete(copy.key)
          reopen(draftFromCopy(copy))
        },
      },
      cancel: {
        label: __('Discard'),
        onClick: () => discardDraftCopy(copy),
      },
      classes: {
        cancelButton: '!ml-auto mr-1 h-7 shrink-0 rounded-4 bg-transparent !transition-colors',
        actionButton: '!ml-0',
      },
    })
    offers.set(copy.key, offer)
  }
}
