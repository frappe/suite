<!--
  Mail > Advanced > Automation: the rules the mail server runs on each message as it arrives (Sieve
  scripts), which file mail into folders and send automatic replies. Folder rules and the vacation
  response write their own script; this lists the ones written by hand.
-->
<template>
  <SettingsSection
    :title="__('Automation')"
    :description="
      __(
        'Rules the mail server runs on each new message, to file it or answer it. Written in the Sieve language.',
      )
    "
  >
    <template #actions>
      <Button icon-left="lucide-plus" :label="__('New')" @click="addScript" />
    </template>
    <SettingsLoading v-if="!sieveScripts.data" />
    <template v-else>
      <SettingsListRow
        v-for="script in scripts"
        :key="script.name"
        :title="script._name"
        :menu="scriptMenu(script)"
        @open="editScript(script)"
      >
        <template v-if="script.active" #trailing>
          <Badge :label="__('Active')" theme="blue" variant="subtle" />
        </template>
      </SettingsListRow>
      <SettingsEmpty
        v-if="!scripts.length"
        :title="__('No rules of your own')"
        :description="
          __(
            'Your folder rules and vacation response run without one. Add a rule script for anything else.',
          )
        "
      />
      <SettingsRow
        :title="__('Rebuild folder rules')"
        :description="__('Write the server rules again from the rules saved on your folders')"
      >
        <Button
          :label="__('Rebuild')"
          :loading="rebuild.isPending"
          @click="void rebuildSubmit().catch(() => {})"
        />
      </SettingsRow>
    </template>

    <SieveScriptModal v-model="showScript" :selected-script />
    <SetSieveScriptStateModal
      v-if="selectedScript"
      v-model="showSetActive"
      :script="selectedScript"
    />
    <DeleteSieveScriptModal v-if="selectedScript" v-model="showDelete" :script="selectedScript" />
  </SettingsSection>
</template>

<script setup lang="ts">
import { Badge, Button, SettingsRow } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useMutation } from '@/api'
import DeleteSieveScriptModal from '@/apps/mail/components/Modals/DeleteSieveScriptModal.vue'
import SetSieveScriptStateModal from '@/apps/mail/components/Modals/SetSieveScriptStateModal.vue'
import SieveScriptModal from '@/apps/mail/components/Modals/SieveScriptModal.vue'
import { userStore } from '@/apps/mail/stores/user'
import type { SieveScript } from '@/apps/mail/types'
import { toast } from '@/platform/feedback'
import {
  SettingsEmpty,
  SettingsListRow,
  SettingsLoading,
  SettingsSection,
} from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const store = userStore()
const { sieveScripts } = store
// The folder rules' own script is rebuilt below, not edited by hand.
const scripts = computed(
  () =>
    sieveScripts.data?.filter((s) => !s.read_only && s._name !== 'frappe_mail_automation') ?? [],
)

const rebuild = useMutation(api.mail.sieve.rebuildAutomation)
async function rebuildSubmit() {
  await rebuild.run({ account: store.accountId })
  toast.success(__('Folder rules rebuilt'))
}

const showScript = ref(false)
const showSetActive = ref(false)
const showDelete = ref(false)
const selectedScript = ref<SieveScript>()
function addScript() {
  selectedScript.value = undefined
  showScript.value = true
}
function editScript(script: SieveScript) {
  selectedScript.value = script
  showScript.value = true
}
const scriptMenu = (script: SieveScript) => [
  {
    label: script.active ? __('Turn off') : __('Turn on'),
    icon: script.active ? 'lucide-pause' : 'lucide-play',
    onClick: () => {
      selectedScript.value = script
      showSetActive.value = true
    },
  },
  { label: __('Edit'), icon: 'lucide-pencil', onClick: () => editScript(script) },
  // Only one script runs at a time, and the running one cannot be deleted.
  ...(script.active
    ? []
    : [
        {
          label: __('Delete'),
          icon: 'lucide-trash-2',
          theme: 'red' as const,
          onClick: () => {
            selectedScript.value = script
            showDelete.value = true
          },
        },
      ]),
]
</script>
