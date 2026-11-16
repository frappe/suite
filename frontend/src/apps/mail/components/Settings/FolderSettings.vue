<!--
  Mail > Folders: the active account's folders. A row opens the folder's settings; its menu hides,
  shows or deletes it.
-->
<template>
  <SettingsPage
    :title="__('Folders')"
    :description="__('Make, rename and arrange the folders you file mail into')"
    :loading="!mailboxes.data"
  >
    <SettingsSection>
      <template #actions>
        <Button icon-left="lucide-plus" :label="__('New')" @click="editMailbox()" />
      </template>
      <template v-if="mailboxes.data?.length">
        <SettingsListRow
          v-for="mailbox in mailboxes.data"
          :key="mailbox.name"
          :title="mailbox._name"
          :subtitle="summary(mailbox)"
          :menu="mailboxMenu(mailbox)"
          @open="editMailbox(mailbox)"
        >
          <template #leading>
            <Icon
              :name="getIcon(mailbox)"
              class="size-4 shrink-0"
              :class="mailbox.color ? FOLDER_ICON_COLOR_MAP[mailbox.color] : 'text-ink-gray-6'"
            />
          </template>
        </SettingsListRow>
      </template>
      <SettingsEmpty
        v-else
        icon="lucide-folder"
        :title="__('No folders yet')"
        :description="__('Folders keep related mail together.')"
      />
    </SettingsSection>

    <FolderModal v-model="showFolderModal" :mailbox="selectedMailbox" />
    <DeleteFolderModal v-model="showDeleteFolderModal" :mailbox="selectedMailbox" />
  </SettingsPage>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { Icon } from 'frappe-ui/experimental'
import { ref } from 'vue'

import { api, useMutation } from '@/api'
import DeleteFolderModal from '@/apps/mail/components/Modals/DeleteFolderModal.vue'
import FolderModal from '@/apps/mail/components/Modals/FolderModal.vue'
import { FOLDER_ICON_COLOR_MAP } from '@/apps/mail/constants'
import { userStore } from '@/apps/mail/stores/user'
import type { MailboxData } from '@/apps/mail/types'
import { getIcon } from '@/apps/mail/utils'
import {
  SettingsEmpty,
  SettingsListRow,
  SettingsPage,
  SettingsSection,
} from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const { mailboxes } = userStore()
const showFolderModal = ref(false)
const selectedMailbox = ref<MailboxData>()
const showDeleteFolderModal = ref(false)

const editMailbox = (mailbox?: MailboxData) => {
  selectedMailbox.value = mailbox
  showFolderModal.value = true
}

/** What is set on the folder, where it differs from a plain folder. */
function summary(mailbox: MailboxData) {
  const parts: string[] = []
  if (!mailbox.subscribed) parts.push(__('Hidden'))
  if (mailbox.disable_push_notification) parts.push(__('Notifications off'))
  if (mailbox.automation_rules) parts.push(__('Files mail by rule'))
  return parts.join(' · ') || undefined
}

const subscribe = useMutation(api.mail.mailboxes.subscribe)
const mailboxMenu = (mailbox: MailboxData) => [
  {
    label: mailbox.subscribed ? __('Hide') : __('Show'),
    icon: mailbox.subscribed ? 'lucide-eye-off' : 'lucide-eye',
    onClick: () =>
      void subscribe
        .run({ name: mailbox.name, subscribed: mailbox.subscribed ? 0 : 1 })
        .catch(() => {}),
  },
  {
    label: __('Edit'),
    icon: 'lucide-pencil',
    onClick: () => editMailbox(mailbox),
  },
  {
    label: __('Delete'),
    icon: 'lucide-trash-2',
    theme: 'red' as const,
    onClick: () => {
      selectedMailbox.value = mailbox
      showDeleteFolderModal.value = true
    },
  },
]
</script>
