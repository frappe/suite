import { createResource } from 'frappe-ui'
import { computed } from 'vue'

type Option = { value: string; label: string }

// Locales and time zones are long, fixed lists (hundreds of entries each) shared by the member and
// group editors, so they are fetched once and cached rather than per dialog.
const accountOptions = createResource({
  url: 'suite.mail.api.admin.get_account_options',
  cache: 'accountOptions',
})

const localeLabels = computed(() => {
  const locales: Option[] = accountOptions.data?.locales || []
  return new Map(locales.map((o) => [o.value, o.label]))
})

export const useAccountOptions = () => {
  if (!accountOptions.fetched && !accountOptions.loading) accountOptions.fetch()

  return {
    localeOptions: computed<Option[]>(() => accountOptions.data?.locales || []),
    // Accounts store the bare locale code, so the detail pages resolve it against the same list
    // the picker uses. Falls back to the code itself until the list has loaded.
    localeLabel: (value?: string | null) => (value ? localeLabels.value.get(value) || value : ''),
    // The time zone is nullable on the server, so it needs a blank choice to clear it.
    timeZoneOptions: computed<Option[]>(() => [
      { value: '', label: __('Not set') },
      ...(accountOptions.data?.time_zones || []),
    ]),
  }
}
