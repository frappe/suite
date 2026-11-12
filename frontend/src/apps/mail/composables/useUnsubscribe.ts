import { toast } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useQuery } from '@/api'
import type { Mail } from '@/apps/mail/types'
import { commitAfterUndo } from '@/apps/mail/utils'

/**
 * Unsubscribing from a list, from the open thread (see suite/mail/unsubscribe.py; decided in the
 * mail-ux ticket 033). A message offers it when its List-Unsubscribe header does and `allowed` lets
 * it — mail you received, never in Junk, nor while the Screener is asking about its sender.
 *
 * The request can't be taken back once it reaches the sender, so it waits out an Undo as a
 * permanent delete does (commitAfterUndo): the message reads as unsubscribed at once, and Undo puts
 * it back before anything is sent. A sender offering only a page gets it opened; the person
 * unsubscribes there, and nothing is marked.
 */
export function useUnsubscribe(
  account: () => string,
  messages: () => Mail[],
  allowed: (mail: Mail) => boolean,
) {
  const ids = computed(() =>
    messages()
      .filter(allowed)
      .map((mail) => mail.id),
  )
  const options = useQuery(api.mail.messages.unsubscribeOptions, () =>
    ids.value.length ? { account: account(), ids: ids.value } : false,
  )
  // Unsubscribed on screen ahead of the server, while the request waits out its Undo. By account and
  // message: All Inboxes shows several accounts in one pane, and a message id is only an account's.
  const held = ref(new Set<string>())
  const heldKey = (mail: Mail) => `${account()}:${mail.id}`

  const optionOf = (mail: Mail) => (allowed(mail) ? options.data?.[mail.id] : undefined)
  const offers = (mail: Mail) => !!optionOf(mail)
  const isUnsubscribed = (mail: Mail) =>
    held.value.has(heldKey(mail)) || !!optionOf(mail)?.unsubscribed

  const hold = (id: string, on: boolean) => {
    const next = new Set(held.value)
    if (on) next.add(id)
    else next.delete(id)
    held.value = next
  }

  const unsubscribe = (mail: Mail) => {
    const option = optionOf(mail)
    if (!option || isUnsubscribed(mail)) return
    if (!option.one_click && !option.mailto) {
      if (option.link) window.open(option.link, '_blank', 'noopener')
      return
    }
    const key = heldKey(mail)
    hold(key, true)
    commitAfterUndo({
      message: __('Unsubscribed.'),
      removal: { kind: 'unsubscribe', account: account(), id: mail.id },
      // Sent, the look-up is read again (see the client policy) and says so itself.
      restore: () => hold(key, false),
      // Refused or unanswered: the sender's page is the way left, where there is one.
      onFailed: () =>
        toast.error(
          __("Couldn't unsubscribe."),
          option.link
            ? {
                action: {
                  label: __('Open their page'),
                  onClick: () => window.open(option.link!, '_blank', 'noopener'),
                },
              }
            : undefined,
        ),
    })
  }

  return { offers, isUnsubscribed, unsubscribe }
}
