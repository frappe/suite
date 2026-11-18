<template>
  <div class="flex flex-col gap-3">
    <SettingsDialogActions>
      <Button
        icon-left="lucide-refresh-cw"
        :label="__('Rebuild folder automation')"
        :loading="rebuildAutomation.isPending"
        :tooltip="__('Builds folder automation again from the Automation tab of each folder.')"
        @click="rebuildAutomationSubmit()"
      />
      <Button variant="solid" icon-left="lucide-plus" :label="__('New rule')" @click="addScript" />
    </SettingsDialogActions>
    <div v-if="filteredScripts.length">
      <div
        v-for="script in filteredScripts"
        :key="script.name"
        class="hover:bg-surface-gray-1 -mx-2 flex cursor-pointer items-center justify-between rounded-4 px-3 py-1"
        @click="editScript(script)"
      >
        <div class="flex items-center gap-2">
          <span class="text-base">{{ script._name }}</span>
          <Badge v-if="script.active" :label="__('On')" theme="blue" size="sm" />
        </div>
        <Dropdown :options="scriptOptions(script)">
          <Button variant="ghost" @click.stop>
            <template #icon>
              <Ellipsis class="text-ink-gray-5 h-4 w-4" />
            </template>
          </Button>
        </Dropdown>
      </div>
    </div>

    <SettingsEmptyList
      v-else
      :title="__('No rules yet')"
      :description="__('Rules are Sieve scripts that sort and file incoming mail for you.')"
    >
      <a
        class="text-p-base text-ink-blue-link hover:underline"
        href="https://stalw.art/docs/category/sieve-scripting/"
        target="_blank"
      >
        {{ __('Learn about Sieve scripts') }}
      </a>
    </SettingsEmptyList>

    <SieveScriptModal v-model="showSieveScript" :selected-script />
    <SetSieveScriptStateModal
      v-if="selectedScript"
      v-model="showSetScriptAsActive"
      :script="selectedScript"
    />
    <DeleteSieveScriptModal
      v-if="selectedScript"
      v-model="showDeleteScript"
      :script="selectedScript"
    />
  </div>
</template>

<script setup lang="ts">
import { Badge, Button, Dropdown } from 'frappe-ui'
import { Ellipsis } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import DeleteSieveScriptModal from '@/apps/mail/components/Modals/DeleteSieveScriptModal.vue'
import SetSieveScriptStateModal from '@/apps/mail/components/Modals/SetSieveScriptStateModal.vue'
import SieveScriptModal from '@/apps/mail/components/Modals/SieveScriptModal.vue'
import { userStore } from '@/apps/mail/stores/user'
import type { SieveScript } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import SettingsEmptyList from '@/platform/settings/SettingsEmptyList.vue'
import { translate as __ } from '@/platform/translation'

const store = userStore()
const { sieveScripts } = store
const rebuildAutomation = useMutation(api.mail.sieve.rebuildAutomation)
async function rebuildAutomationSubmit() {
  const input: InputOf<typeof api.mail.sieve.rebuildAutomation> = {
    account: store.accountId,
  }
  await rebuildAutomation.run(input)
  raiseToast(__('Folder automation rebuilt'))
}
const showSieveScript = ref(false)
const selectedScript = ref<SieveScript>()
const showSetScriptAsActive = ref(false)
const showDeleteScript = ref(false)
const filteredScripts = computed(
  () =>
    sieveScripts.data?.filter((s) => !s.read_only && s._name !== 'frappe_mail_automation') || [],
)
const addScript = () => {
  selectedScript.value = undefined
  showSieveScript.value = true
}
const editScript = (script: SieveScript) => {
  selectedScript.value = script
  showSieveScript.value = true
}

function switchLabel(script: SieveScript) {
  if (script.active) {
    return __('Turn off')
  }

  return __('Turn on')
}

const scriptOptions = (script: SieveScript) => [
  {
    label: switchLabel(script),
    icon: script.active ? 'eye-off' : 'eye',
    onClick: () => {
      selectedScript.value = script
      showSetScriptAsActive.value = true
    },
  },
  {
    label: __('Edit'),
    icon: 'lucide-edit-2',
    onClick: () => editScript(script),
  },
  {
    label: __('Delete'),
    icon: 'lucide-trash-2',
    theme: 'red' as const,
    onClick: () => {
      selectedScript.value = script
      showDeleteScript.value = true
    },
    condition: () => !script.active,
  },
]
</script>
