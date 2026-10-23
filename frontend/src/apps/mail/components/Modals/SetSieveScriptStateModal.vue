<template>
  <Dialog v-model:open="show" v-bind="dialogOptions" />
</template>

<script setup lang="ts">
import { Dialog } from 'frappe-ui'
import { computed } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import { getScriptName, isSystemScript, raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const { script, action } = defineProps<{
  script: {
    _name: string
    active?: number
    account?: string
    id?: string
    content?: string
  }
  action?: () => void | Promise<unknown>
}>()
const store = userStore()
const { sieveScripts } = store
const activeScript = computed(() => sieveScripts.data?.find((s) => s.active)?._name)
const dialogOptions = computed(() => ({
  title: title.value,
  message: message.value,
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
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
      onClick: () => (action ? action() : setScriptStateSubmit()),
    },
    {
      label: __('Cancel'),
      variant: 'outline' as const,
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
    return __('All rules and filters associated with this script will take effect immediately.')
  return __('{0} {1} will {2} {3}. Do you want to proceed?', [
    isSystemScript(script._name) ? __('Enabling') : __('Activating'),
    getScriptName(script._name),
    isSystemScript(activeScript.value) ? __('disable') : __('deactivate'),
    getScriptName(activeScript.value),
  ])
})
const setScriptState = useMutation(api.mail.sieve.update)
async function setScriptStateSubmit() {
  const input: InputOf<typeof api.mail.sieve.update> = {
    account: script.account ?? store.accountId,
    id: script.id ?? '',
    _name: script._name,
    content: script.content ?? '',
    active: !script.active,
  }
  await setScriptState.run(input)
  raiseToast(
    script.active
      ? __('{0} deactivated.', [getScriptName(script._name)])
      : __('{0} {1}.', [
          getScriptName(script._name),
          isSystemScript(script._name) ? __('enabled') : __('activated'),
        ]),
  )
  show.value = false
}
</script>
