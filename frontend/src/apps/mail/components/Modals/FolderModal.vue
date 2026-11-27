<template>
  <AdaptiveDialog
    v-model:open="show"
    v-bind="{
      title: isNew ? __('New folder') : __('Edit folder'),
      size: 'xl' as const,
      paddingTop: '10%',
      actions: [
        {
          label: __('Save'),
          variant: 'solid' as const,
          disabled: !folder.name || (!isNew && isNotDirty),
          onClick: () => (isNew ? createFolderSubmit() : updateFolderSubmit()),
        },
      ],
    }"
  >
    <template #default>
      <!-- One height for both tabs, so the dialog doesn't jump as they are switched; a longer
           Automation tab scrolls inside it. -->
      <Tabs v-model="tab" class="flex h-96 flex-col">
        <!-- On a phone the tabs share the sheet's width, words alone: a desktop's row of tabs with
             icons, hugging the left, looked out of place there -->
        <TabButtons v-if="isMobile" v-model="tab" :options="PHONE_TABS" variant="underline" fluid />
        <TabList v-else>
          <TabTrigger
            v-for="item in TABS"
            :key="item.value"
            :value="item.value"
            :label="item.label"
            :icon-left="item.iconLeft"
          />
        </TabList>
        <TabPanel v-for="panel in TABS" :key="panel.value" :value="panel.value">
          <!-- px-0.5: the tab panel is an `overflow-auto` scroll container, and a focus ring
					     is a box-shadow — which is clipped by an overflowing ancestor rather than
					     scrolled to. A full-width control therefore had its ring shaved off both sides.
					     Two pixels of inset gives it somewhere to draw. -->
          <div class="space-y-4 px-0.5 pt-4 sm:pt-6">
            <!-- General -->
            <template v-if="panel.value === 'general'">
              <FormControl v-model="folder.name" :label="__('Name')" variant="outline" required />
              <div class="space-y-1.5">
                <!-- The picker has no label of its own, so this one is set as a field's label is -->
                <label class="text-ink-gray-6 leading-tighter block text-sm">
                  {{ __('Icon') }}
                </label>
                <IconPicker v-model="folder.icon" variant="outline" />
              </div>
              <FormControl
                v-model="folder.color"
                type="select"
                :label="__('Color')"
                :options="COLOR_OPTIONS"
                variant="outline"
              >
                <template #prefix>
                  <span
                    class="h-4 w-4 shrink-0 rounded-full"
                    :class="FOLDER_COLOR_MAP[folder.color]"
                  />
                </template>
              </FormControl>
              <SettingsRow :title="__('Notifications')" class="!pb-0">
                <Switch v-model="pushNotifications" :disabled="isNotificationsDisabled" />
              </SettingsRow>
            </template>

            <!-- Automation  -->
            <template v-else>
              <Alert
                v-if="activeScript !== 'frappe_mail_automation'"
                :title="__('Folder automation is off')"
                :description="__('Nothing on this tab runs until you turn it on.')"
                theme="amber"
                :dismissable="false"
              >
                <template #actions>
                  <Button
                    :label="__('Turn on')"
                    variant="outline"
                    @click="showEnableFolderAutomation = true"
                  />
                </template>
              </Alert>
              <FormControl
                v-model="automationRules.emails_from"
                :label="__('Emails From')"
                placeholder="john@example.com, jane@example.com, *@example.io"
                variant="outline"
                :description="
                  __('Emails from these addresses will be automatically moved to this folder.')
                "
              />
              <FormControl
                v-model="automationRules.subject_contains"
                :label="__('Subject Contains')"
                placeholder="Important, Urgent, Follow Up"
                variant="outline"
                :description="
                  __(
                    'Emails with these keywords in the subject will be automatically moved to this folder.',
                  )
                "
              />
              <FormControl
                v-if="automationRules.emails_from && automationRules.subject_contains"
                v-model="automationRules.match_if"
                :label="__('Match If')"
                type="select"
                variant="outline"
                :options="[
                  { label: __('Either condition is met'), value: 'any' },
                  { label: __('Both conditions are met'), value: 'all' },
                ]"
              />
              <template v-if="automationRules.emails_from || automationRules.subject_contains">
                <hr />
                <SettingsRow
                  :title="__('Mark as Read')"
                  :description="
                    __('Automatically mark emails as read when they are moved to this folder.')
                  "
                  class="!py-0"
                >
                  <Switch
                    v-model="automationRules.mark_as_read"
                    :disabled="isNotificationsDisabled"
                  />
                </SettingsRow>
                <SettingsRow
                  :title="__('Add Star')"
                  :description="__('Automatically star emails when they are moved to this folder.')"
                  class="!py-0"
                >
                  <Switch v-model="automationRules.add_star" :disabled="isNotificationsDisabled" />
                </SettingsRow>
              </template>
            </template>
          </div>
        </TabPanel>
      </Tabs>
      <!-- Under both tabs, as either one's fields can be what was refused -->
      <ErrorMessage :message="saveError" class="mt-4" />
    </template>
  </AdaptiveDialog>

  <SetSieveScriptStateModal
    v-model="showEnableFolderAutomation"
    :script="automationScript || DEFAULT_AUTOMATION_SCRIPT"
    :action="automationScript ? undefined : createAutomationScriptSubmit"
  />
</template>

<script setup lang="ts">
import {
  Alert,
  Button,
  ErrorMessage,
  FormControl,
  SettingsRow,
  Switch,
  TabButtons,
  TabList,
  TabPanel,
  Tabs,
  TabTrigger,
} from 'frappe-ui'
import { IconPicker } from 'frappe-ui/experimental'
import { Settings, Zap } from 'lucide-vue-next'
import { computed, reactive, ref, watch } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import SetSieveScriptStateModal from '@/apps/mail/components/Modals/SetSieveScriptStateModal.vue'
import { FOLDER_COLOR_MAP, FOLDER_ICON_MAP } from '@/apps/mail/constants'
import { userStore } from '@/apps/mail/stores/user'
import type { MailboxData } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { failureLine } from '@/platform/feedback'
import AdaptiveDialog from '@/platform/feedback/AdaptiveDialog.vue'
import { translate as __ } from '@/platform/translation'

const show = defineModel<boolean>()
const { mailbox } = defineProps<{
  mailbox?: MailboxData
}>()
const store = userStore()
const { sieveScripts } = store
const isNew = computed(() => !mailbox)
const activeScript = computed(() => sieveScripts.data?.find((s) => s.active)?._name)
const automationScript = computed(() =>
  sieveScripts.data?.find((s) => s._name === 'frappe_mail_automation'),
)
const tab = ref('general')
const { isMobile } = useScreenSize()

// iconLeft, not icon: `icon` is Tabs' icon-only trigger — it drops the label.
const TABS = [
  {
    value: 'general',
    label: __('General'),
    iconLeft: Settings,
  },
  {
    value: 'automation',
    label: __('Automation'),
    iconLeft: Zap,
  },
]
// Words alone on a phone, where the two halves of a full-width control say enough
const PHONE_TABS = TABS.map(({ value, label }) => ({ value, label }))
const DEFAULT_FOLDER = {
  id: '',
  name: '',
  // SAFETY: These empty defaults are valid nullable mailbox role/id values;
  // the unions retain the types of later edits rather than the literal null.
  role: null as string | null,
  // SAFETY: A folder starts without a parent, then accepts a mailbox id or null.
  parent: null as string | null,
  icon: 'folder',
  color: 'Gray',
  disable_push_notification: false,
}
const folder = reactive({
  ...DEFAULT_FOLDER,
})
const original = reactive({
  ...DEFAULT_FOLDER,
})
const isNotificationsDisabled = computed(
  () =>
    !isNew.value &&
    !!mailbox?.role &&
    ['sent', 'drafts', 'junk', 'trash', 'archive'].includes(mailbox.role),
)
// The folder stores the opt-out; the switch says whether notifications come, so it is on by default
const pushNotifications = computed({
  get: () => !folder.disable_push_notification,
  set: (on: boolean) => (folder.disable_push_notification = !on),
})
const isNotDirty = computed(() => {
  const folderUnchanged =
    folder.name === original.name &&
    folder.icon === original.icon &&
    folder.color === original.color &&
    folder.disable_push_notification === original.disable_push_notification
  const automationUnchanged =
    automationRules.emails_from === originalAutomationRules.emails_from &&
    automationRules.subject_contains === originalAutomationRules.subject_contains &&
    automationRules.mark_as_read === originalAutomationRules.mark_as_read &&
    automationRules.add_star === originalAutomationRules.add_star &&
    automationRules.match_if === originalAutomationRules.match_if
  return folderUnchanged && automationUnchanged
})
// A refused save is said in the form, where the eyes are, so no toast says it too
const createFolder = useMutation(api.mail.mailboxes.create, { silent: true })
async function createFolderSubmit() {
  const input: InputOf<typeof api.mail.mailboxes.create> = {
    account: store.accountId,
    name: folder.name,
    parent: folder.parent,
    icon: folder.icon,
    color: folder.color,
    disable_push_notification: folder.disable_push_notification,
    automation_rules: isDefaultAutomation.value ? null : automationRules,
  }
  await createFolder.run(input)
  raiseToast(__('Folder created'))
  show.value = false
}

const updateFolder = useMutation(api.mail.mailboxes.update, { silent: true })
const saveError = computed(() => failureLine(createFolder.error ?? updateFolder.error))
async function updateFolderSubmit() {
  const input: InputOf<typeof api.mail.mailboxes.update> = {
    account: store.accountId,
    ...folder,
    old_name: original.name,
    automation_rules: isDefaultAutomation.value ? null : automationRules,
  }
  await updateFolder.run(input)
  raiseToast(__('Folder updated'))
  show.value = false
}
const createAutomationScript = useMutation(api.mail.sieve.createAutomation)
async function createAutomationScriptSubmit() {
  const input: InputOf<typeof api.mail.sieve.createAutomation> = {
    account: store.accountId,
    active: true,
  }
  await createAutomationScript.run(input)
  raiseToast(__('Folder automation turned on'))
  showEnableFolderAutomation.value = false
}
watch(show, (val) => {
  if (!val) return
  tab.value = 'general'
  // What the last visit was refused is not said on this one
  createFolder.reset()
  updateFolder.reset()
  Object.assign(automationRules, DEFAULT_AUTOMATION_RULES)
  Object.assign(originalAutomationRules, DEFAULT_AUTOMATION_RULES)
  if (!mailbox) {
    Object.assign(folder, DEFAULT_FOLDER)
    return
  }
  folder.id = original.id = mailbox.id
  folder.name = original.name = mailbox._name
  folder.role = original.role = mailbox.role
  folder.icon = original.icon =
    mailbox.icon || (mailbox.role ? FOLDER_ICON_MAP[mailbox.role] : undefined) || 'folder'
  folder.color = original.color = mailbox.color || 'Gray'
  folder.disable_push_notification = original.disable_push_notification =
    isNotificationsDisabled.value ? true : !!mailbox.disable_push_notification

  // Rules come from the Mailbox Settings backup (mailbox.automation_rules), so they survive even if
  // the sieve script was deleted by a third-party client.
  if (mailbox.automation_rules) {
    Object.assign(automationRules, {
      ...DEFAULT_AUTOMATION_RULES,
      ...mailbox.automation_rules,
    })
    Object.assign(originalAutomationRules, {
      ...DEFAULT_AUTOMATION_RULES,
      ...mailbox.automation_rules,
    })
  }
})
const COLOR_OPTIONS = [
  {
    label: __('Gray'),
    value: 'Gray',
  },
  {
    label: __('Blue'),
    value: 'Blue',
  },
  {
    label: __('Green'),
    value: 'Green',
  },
  {
    label: __('Amber'),
    value: 'Amber',
  },
  {
    label: __('Red'),
    value: 'Red',
  },
  {
    label: __('Purple'),
    value: 'Purple',
  },
]
const DEFAULT_AUTOMATION_RULES = {
  emails_from: '',
  subject_contains: '',
  mark_as_read: false,
  add_star: false,
  match_if: 'any' as const,
}
const automationRules = reactive({
  ...DEFAULT_AUTOMATION_RULES,
})
const originalAutomationRules = reactive({
  ...DEFAULT_AUTOMATION_RULES,
})
const isDefaultAutomation = computed(
  () => JSON.stringify(automationRules) === JSON.stringify(DEFAULT_AUTOMATION_RULES),
)
const showEnableFolderAutomation = ref(false)
const DEFAULT_AUTOMATION_SCRIPT = {
  _name: 'frappe_mail_automation',
}
</script>
