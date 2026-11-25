<template>
  <AdaptiveDialog v-model:open="show" v-bind="dialogOptions" />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import { raiseToast, turnsOffLine } from '@/apps/mail/utils'
import AdaptiveDialog from '@/platform/feedback/AdaptiveDialog.vue'
import { translate as __ } from '@/platform/translation'

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

/** Every line of the question, as it is said of folder automation. */
function folderAutomationWords() {
  return {
    askOn: __('Turn on folder automation?'),
    askOff: __('Turn off folder automation?'),
    turnOn: __('Turn on folder automation'),
    turnOff: __('Turn off folder automation'),
    starts: __('Folder automation starts sorting new mail right away.'),
    stops: __('Folder automation stops sorting new mail right away.'),
    turnedOn: __('Folder automation turned on'),
    turnedOff: __('Folder automation turned off'),
  }
}

/** Every line of the question, as it is said of a rule of the user's own. */
function ruleWords(name: string) {
  return {
    askOn: __('Turn on “{0}”?', [name]),
    askOff: __('Turn off “{0}”?', [name]),
    turnOn: __('Turn on rule'),
    turnOff: __('Turn off rule'),
    starts: __('This rule starts running on new mail right away.'),
    stops: __('This rule stops running on new mail right away.'),
    turnedOn: __('Rule turned on'),
    turnedOff: __('Rule turned off'),
  }
}

const words = computed(() => {
  if (script._name === 'frappe_mail_automation') {
    return folderAutomationWords()
  }

  return ruleWords(script._name)
})
const title = computed(() => {
  if (script.active) {
    return words.value.askOff
  }

  return words.value.askOn
})
const confirmLabel = computed(() => {
  if (script.active) {
    return words.value.turnOff
  }

  return words.value.turnOn
})
const message = computed(() => {
  if (script.active) {
    return words.value.stops
  }

  if (!activeScript.value) {
    return words.value.starts
  }

  // The mail server runs one script at a time, so this one takes the place of the one running
  return __('{0} Only one of auto-reply, folder automation and your rules can be on at a time.', [
    turnsOffLine(activeScript.value),
  ])
})
const dialogOptions = computed(() => ({
  title: title.value,
  message: message.value,
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [
    {
      label: confirmLabel.value,
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
  if (script.active) {
    raiseToast(words.value.turnedOff)
  } else {
    raiseToast(words.value.turnedOn)
  }

  show.value = false
}
</script>
