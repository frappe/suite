import { api, client, useQuery, type InputOf, type OutputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import { useSavedFields } from '@/platform/settings-tab'

type AccountPreferences = OutputOf<typeof api.mail.settings.account>
type AccountChanges = InputOf<typeof api.mail.settings.updateAccount>['changes']
type AccountField = keyof AccountChanges & keyof AccountPreferences

/**
 * The Mail preferences (sending, screening, remote images) of the account active when the caller
 * is set up, for Settings tabs where each control saves on change. `preferences` is what the
 * controls show; `save` changes one field, as `useSavedFields` describes. The save's own error
 * feedback reports a failure. `read` is the read behind them, for the tab's load failure and retry.
 *
 * The account stays fixed for the caller's life, so a change goes to the account it was made in,
 * and its queued saves finish there after an account switch. `MailSettingsScope` remounts the tab
 * for the new account.
 */
export function useAccountPreferences() {
  const account = userStore().accountId
  const saved = useQuery(api.mail.settings.account, () => (account ? { account } : false))
  const { shown: preferences, save } = useSavedFields<AccountPreferences>(
    () => saved.data,
    (changes) => () => client.mutation(api.mail.settings.updateAccount, { account, changes }),
  )

  /** A 0/1 preference as a switch: its value, and its save. */
  type FlagField = {
    [K in AccountField]: AccountPreferences[K] extends 0 | 1 ? K : never
  }[AccountField]
  const flag = (field: FlagField) => !!preferences.value?.[field]
  const setFlag = (field: FlagField, on: boolean) => save(field, on ? 1 : 0)

  return { preferences, read: saved, save, flag, setFlag }
}
