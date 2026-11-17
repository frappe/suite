import { ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf, type OutputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'

type AccountPreferences = OutputOf<typeof api.mail.settings.account>
type AccountChanges = InputOf<typeof api.mail.settings.updateAccount>['changes']
type AccountField = keyof AccountChanges & keyof AccountPreferences

/**
 * The active account's Mail preferences (sending, screening, remote images), for Settings tabs
 * where each control saves on change. `preferences` is what the controls show: a change shows at
 * once, and goes back to what it was when the save fails. The save's own error feedback reports
 * the failure. `read` is the read behind them, for the tab's load failure and retry.
 */
export function useAccountPreferences() {
  // Read store.accountId live; destructuring would miss an account switch while the tab is open.
  const store = userStore()
  const saved = useQuery(api.mail.settings.account, () =>
    store.accountId ? { account: store.accountId } : false,
  )
  const preferences = ref<AccountPreferences>()
  watch(
    () => saved.data,
    (data) => {
      preferences.value = data ? { ...data } : undefined
    },
    { immediate: true },
  )

  const update = useMutation(api.mail.settings.updateAccount)

  async function save<K extends AccountField>(field: K, value: AccountPreferences[K]) {
    const shown = preferences.value
    if (!shown || shown[field] === value) return
    const previous = shown[field]
    shown[field] = value
    const changes: AccountChanges = { [field]: value }
    try {
      await update.run({ account: store.accountId, changes })
    } catch {
      // Only when nothing newer has replaced what the controls show.
      if (preferences.value === shown && shown[field] === value) shown[field] = previous
    }
  }

  /** A 0/1 preference as a switch: its value, and its save. */
  type FlagField = {
    [K in AccountField]: AccountPreferences[K] extends 0 | 1 ? K : never
  }[AccountField]
  const flag = (field: FlagField) => !!preferences.value?.[field]
  const setFlag = (field: FlagField, on: boolean) => save(field, on ? 1 : 0)

  return { preferences, read: saved, save, flag, setFlag }
}
