import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { userStore } from '@/apps/mail/stores/user'
import { currentMailboxParam } from '@/apps/mail/utils/unifiedFolders'

/**
 * The URL names an account's folder by its slug, which a rename changes — or a delete takes away —
 * while the folder is open. Follow it to its new name, or out to the account's default folder, rather
 * than leave the URL naming nothing (see utils/unifiedFolders).
 *
 * During an account switch the folder list turns to the new account's before the URL does, so the
 * old account's folder would look deleted and a replace would cancel the switch. A URL is judged
 * only against its own account's folders.
 */
export const useFollowOpenFolder = () => {
  const route = useRoute()
  const router = useRouter()
  const store = userStore()
  watch(
    () => [route.name, route.params.mailbox, store.accountId, store.mailboxes.data] as const,
    ([name, param, accountId, mailboxes]) => {
      if ((name !== 'mail-mailbox' && name !== 'mail-mail') || !mailboxes) return
      if (route.params.accountId !== accountId) return
      const next = currentMailboxParam(accountId, param, mailboxes)
      if (next === param) return
      if (next === null)
        return router.replace({ name: 'mail-account-shortcut', params: { accountId } })
      router.replace({
        name,
        params: { ...route.params, mailbox: next },
        query: route.query,
        hash: route.hash,
      })
    },
  )
}
