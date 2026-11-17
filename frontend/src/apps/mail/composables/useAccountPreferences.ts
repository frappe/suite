import { api, useMutation, useQuery, type InputOf, type OutputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import { useSavedFields } from '@/platform/settings-tab'

type AccountPreferences = OutputOf<typeof api.mail.settings.account>
type AccountChanges = InputOf<typeof api.mail.settings.updateAccount>['changes']
type AccountField = keyof AccountChanges & keyof AccountPreferences

/**
 * The active account's Mail preferences (sending, screening, remote images), for Settings tabs
 * where each control saves on change. `preferences` is what the controls show; `save` changes one
 * field, as `useSavedFields` describes. The save's own error feedback reports a failure. `read`
 * is the read behind them, for the tab's load failure and retry.
 */
export function useAccountPreferences() {
  // Read store.accountId live; destructuring would miss an account switch while the tab is open.
  const store = userStore()
  const saved = useQuery(api.mail.settings.account, () =>
    store.accountId ? { account: store.accountId } : false,
  )
  const update = useMutation(api.mail.settings.updateAccount)
  const { shown: preferences, save } = useSavedFields<AccountPreferences>(
    () => saved.data,
    (changes) => update.run({ account: store.accountId, changes }),
  )

  /** A 0/1 preference as a switch: its value, and its save. */
  type FlagField = {
    [K in AccountField]: AccountPreferences[K] extends 0 | 1 ? K : never
  }[AccountField]
  const flag = (field: FlagField) => !!preferences.value?.[field]
  const setFlag = (field: FlagField, on: boolean) => save(field, on ? 1 : 0)

  return { preferences, read: saved, save, flag, setFlag }
}
