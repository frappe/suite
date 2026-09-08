import { computed, watch } from 'vue'
import { createResource } from 'frappe-ui'

import { formatBytes } from '@/apps/mail/utils'
import { userStore } from '@/apps/mail/stores/user'

/**
 * The active account's storage quota, shared by the sidebar meter and the
 * Account settings page. The resource is cached per account, so both read one
 * fetch.
 */
export function useQuota() {
	const store = userStore()

	const quota = createResource({
		url: 'suite.mail.api.account.get_quota',
		auto: true,
		makeParams: () => ({ account: store.accountId }),
		cache: ['quota', store.accountId],
	})

	watch(
		() => store.accountId,
		() => quota.reload(),
	)

	/** Whether the account has a ceiling at all; an unlimited one has nothing to meter. */
	const isLimited = computed(() => (quota.data?.disk_quota ?? 0) > 0)

	const usedPercentage = computed(() => quota.data?.used_percentage ?? 0)

	/** Nearly full: the meter turns red, and the sidebar starts showing it. */
	const isCritical = computed(() => isLimited.value && usedPercentage.value > CRITICAL_FROM)

	const label = computed(() => {
		if (!quota.data) return ''
		if (!isLimited.value) return __('Unlimited ({0} used)', [formatBytes(quota.data.used_quota)])
		return __('{0}% of {1} used', [
			quota.data.used_percentage.toFixed(2),
			formatBytes(quota.data.disk_quota),
		])
	})

	return { quota, isLimited, usedPercentage, isCritical, label }
}

/** Percent used past which storage counts as critical. */
const CRITICAL_FROM = 80
