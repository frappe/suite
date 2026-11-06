import { toast } from 'frappe-ui'

import type { ComposeMailData } from '@/apps/mail/types'
import {
  heldDraftCopyKeys,
  listDraftCopies,
  removeDraftCopy,
  type DraftCopy,
} from '@/apps/mail/utils/draftCopies'

// More than this at once is a wall of toasts. The rest are offered on the next start.
const MAX_OFFERS = 3
const offers = new Map<string, ReturnType<typeof toast.warning>>()

/** The copy has been dealt with some other way: restored in a composer, saved, or ignored. */
export const withdrawDraftCopyOffer = (key: string) => {
  const offer = offers.get(key)
  if (offer === undefined) return
  offers.delete(key)
  toast.dismiss(offer)
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
 * server, in accounts this person still has. A copy a live composer is still working on, here or in
 * another tab, isn't left behind.
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
  const copies = listDraftCopies(user).filter((copy) => accounts.includes(copy.account))
  if (!copies.length) return
  const held = await heldDraftCopyKeys()
  for (const copy of copies.filter((copy) => !held.has(copy.key)).slice(0, MAX_OFFERS)) {
    const subject = copy.mail.subject?.trim() || __('No subject')
    const offer = toast.warning(__('A draft was not saved: {0}', [subject]), {
      description: copy.uploading.length
        ? __('Kept on this device, apart from files still uploading: {0}', [
            copy.uploading.join(', '),
          ])
        : __('Kept on this device.'),
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
        onClick: () => {
          offers.delete(copy.key)
          removeDraftCopy(copy.user, copy.account, copy.key)
        },
      },
      classes: {
        cancelButton: '!ml-auto mr-1 h-7 shrink-0 rounded-4 bg-transparent !transition-colors',
        actionButton: '!ml-0',
      },
    })
    offers.set(copy.key, offer)
  }
}
