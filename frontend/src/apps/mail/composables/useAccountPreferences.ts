import { computed, ref, watch } from 'vue'

import { api, client, useQuery, type InputOf, type OutputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'

type Preferences = OutputOf<typeof api.mail.settings.account>
type Changes = InputOf<typeof api.mail.settings.updateAccount>['changes']
type Flag =
  | 'block_remote_images'
  | 'create_contacts_after_email_submit'
  | 'destroy_email_after_submit'
  | 'destroy_newsletter_after_submit'
  | 'keep_forwarded_email_in_thread'

/**
 * The active account's preferences, each saved as it changes. A change shows at once, and goes back
 * to the saved value when the save is refused.
 */
export function useAccountPreferences() {
  // Read store.accountId live: destructuring would miss an account switch while this stays mounted
  const store = userStore()
  const saved = useQuery(
    api.mail.settings.account,
    () => !!store.accountId && { account: store.accountId },
  )
  // Not a component's mutation: that one is cancelled when its page goes, and a switch flipped just
  // before leaving the page must still be saved
  function save(changes: Changes) {
    return client.mutation(api.mail.settings.updateAccount, { account: store.accountId, changes })
  }

  const preferences = ref<Preferences>()
  function showSaved() {
    preferences.value = saved.data && { ...saved.data }
  }

  watch(() => saved.data, showSaved, { immediate: true })

  async function change(changes: Changes) {
    if (!preferences.value) return

    preferences.value = { ...preferences.value, ...changes }
    // The refusal is reported where every failed save is; here the switch goes back
    await save(changes).catch(showSaved)
  }

  /** One on/off preference, as a switch's `v-model`. */
  function flag(field: Flag) {
    return computed({
      get: () => !!preferences.value?.[field],
      set: (isOn) => void change({ [field]: isOn ? 1 : 0 }),
    })
  }

  // Read, or refused: a page waits for this to draw its rows at once rather than one part after another
  const settled = computed(() => saved.status !== 'pending')

  return { preferences, settled, change, flag }
}
