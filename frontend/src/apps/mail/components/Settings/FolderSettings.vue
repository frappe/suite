<template>
  <div class="flex flex-col gap-3">
    <SettingsDialogActions>
      <Button
        variant="solid"
        icon-left="lucide-plus"
        :label="__('New')"
        :size="buttonSize"
        @click="editMailbox()"
      />
    </SettingsDialogActions>
    <div v-if="managedMailboxes.length">
      <div
        v-for="mailbox in managedMailboxes"
        :key="mailbox.name"
        class="flex min-h-9 items-center justify-between gap-3 py-1 max-sm:min-h-12 max-sm:py-2"
      >
        <div class="text-ink-gray-6 flex min-w-0 items-center gap-2">
          <Icon
            :name="getIcon(mailbox)"
            class="size-4 shrink-0"
            :class="mailbox.color ? FOLDER_ICON_COLOR_MAP[mailbox.color] : undefined"
          />
          <span class="text-ink-gray-8 truncate text-base">{{ mailbox._name }}</span>
          <Badge v-if="isHidden(mailbox)" :label="__('Hidden')" />
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <AdaptiveDropdown :options="mailboxOptions(mailbox)" :title="mailbox._name">
            <Button variant="ghost" :aria-label="__('Folder options')">
              <template #icon>
                <Ellipsis class="text-ink-gray-5 h-4 w-4" />
              </template>
            </Button>
          </AdaptiveDropdown>
          <Button :label="__('Edit')" :size="buttonSize" @click="editMailbox(mailbox)" />
        </div>
      </div>
    </div>

    <div v-else class="text-ink-gray-6 flex flex-col space-y-2 text-sm">
      <p class="text-base-medium">{{ __('No folders yet') }}</p>

      <p>
        {{ __('Folders let you file your mail.') }}
      </p>
    </div>

    <FolderModal v-model="showFolderModal" :mailbox="selectedMailbox" />
    <DeleteFolderModal v-model="showDeleteFolderModal" :mailbox="selectedMailbox" />
  </div>
</template>

<script setup lang="ts">
import { Badge, Button } from 'frappe-ui'
import { Icon } from 'frappe-ui/experimental'
import { Ellipsis, Eye, EyeOff, Trash2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { api, useMutation } from '@/api'
import DeleteFolderModal from '@/apps/mail/components/Modals/DeleteFolderModal.vue'
import FolderModal from '@/apps/mail/components/Modals/FolderModal.vue'
import { FOLDER_ICON_COLOR_MAP } from '@/apps/mail/constants'
import { userStore } from '@/apps/mail/stores/user'
import type { MailboxData } from '@/apps/mail/types'
import { getIcon } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'

const { mailboxes } = userStore()
const { isMobile } = useScreenSize()
const buttonSize = computed(() => (isMobile.value ? 'md' : 'sm'))

const managedMailboxes = computed(() => mailboxes?.data ?? [])
const showFolderModal = ref(false)
const selectedMailbox = ref<MailboxData>()
const showDeleteFolderModal = ref(false)
const editMailbox = (mailbox?: MailboxData) => {
  selectedMailbox.value = mailbox
  showFolderModal.value = true
}
const mailboxOptions = (mailbox: MailboxData) => [
  {
    label: mailbox.subscribed ? __('Hide') : __('Show'),
    icon: mailbox.subscribed ? EyeOff : Eye,
    onClick: () =>
      updateFolder.run({
        name: mailbox.name,
        subscribed: mailbox.subscribed ? 0 : 1,
      }),
  },
  {
    label: __('Delete'),
    icon: Trash2,
    theme: 'red' as const,
    onClick: () => {
      selectedMailbox.value = mailbox
      showDeleteFolderModal.value = true
    },
  },
]
const updateFolder = useMutation(api.mail.mailboxes.subscribe)

// A hidden folder stays out of the Mail sidebar
function isHidden(mailbox: MailboxData) {
  return !mailbox.subscribed
}
</script>
