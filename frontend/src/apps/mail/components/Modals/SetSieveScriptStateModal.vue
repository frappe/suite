<template>
	<Dialog v-model:open="show" v-bind="dialogOptions" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Dialog, createResource } from 'frappe-ui'

import { getScriptName, isSystemScript, raiseToast } from '@/apps/mail/utils'
import { userStore } from '@/apps/mail/stores/user'

import type { SieveScript } from '@/apps/mail/types'

const show = defineModel<boolean>()
const { script, action } = defineProps<{ script: SieveScript; action?: () => void }>()

const { sieveScripts } = userStore()
const activeScript = computed(() => sieveScripts.data?.find((s) => s.active)?._name)

const dialogOptions = computed(() => ({
	title: title.value,
	message: message.value,
	icon: { name: 'lucide-alert-triangle', theme: 'amber' },
	actions: [
		{
			label:
				activeScript.value && !script.active
					? __('Yes, {0} {1}', [
							isSystemScript(activeScript.value) ? __('enable') : __('activate'),
							getScriptName(script._name),
						])
					: __('Confirm'),
			variant: activeScript.value ? 'subtle' : 'solid',
			onClick: () => (action ? action() : setScriptState.submit()),
		},
		{
			label: __('Cancel'),
			variant: 'outline',
			onClick: () => (show.value = false),
		},
	],
}))

const title = computed(() => {
	if (activeScript.value)
		return __('{0} {1}?', [
			isSystemScript(activeScript.value) ? __('Disable') : __('Deactivate'),
			getScriptName(activeScript.value),
		])

	return __('{0} {1}?', [
		isSystemScript(script._name) ? __('Enable') : __('Activate'),
		getScriptName(script._name),
	])
})

const message = computed(() => {
	if (script.active)
		return __(
			'All rules and filters associated with this script will stop functioning immediately.',
		)

	if (!activeScript.value)
		return __(
			'All rules and filters associated with this script will take effect immediately.',
		)

	return __('{0} {1} will {2} {3}. Do you want to proceed?', [
		isSystemScript(script._name) ? __('Enabling') : __('Activating'),
		getScriptName(script._name),
		isSystemScript(activeScript.value) ? __('disable') : __('deactivate'),
		getScriptName(activeScript.value),
	])
})

const setScriptState = createResource({
	url: 'suite.mail.api.sieve.update_sieve_script',
	makeParams: () => ({ ...script, active: !script.active }),
	onSuccess: () => {
		raiseToast(
			script.active
				? __('{0} deactivated.', [getScriptName(script._name)])
				: __('{0} {1}.', [
						getScriptName(script._name),
						isSystemScript(script._name) ? __('enabled') : __('activated'),
					]),
		)
		sieveScripts.reload()
		show.value = false
	},
	onError: (error) => raiseToast(error.message, 'error'),
})
</script>
