<template>
  <AppSettingsHeader
    title="Controls"
    description="Manage join rules, chat, and security for this meeting."
  />
  <AppSettingsBody>
    <div>
      <SettingsRow
        title="Allow Guests"
        description="Allow non-registered users to join this meeting"
      >
        <Switch
          v-model="allowGuest"
          :disabled="updateSettings.isPending || meetingDoc.isFetching"
        />
      </SettingsRow>

      <SettingsRow
        title="Require host approval"
        description="People wait in the lobby until a host or co-host admits them"
      >
        <Switch
          v-model="requireHostApproval"
          :disabled="updateSettings.isPending || meetingDoc.isFetching"
        />
      </SettingsRow>

      <SettingsRow
        title="Host Only Chat"
        description="Restrict chat so only hosts and co-hosts can send messages"
      >
        <Switch
          v-model="hostOnlyChat"
          :disabled="updateSettings.isPending || meetingDoc.isFetching"
        />
      </SettingsRow>

      <E2EESettingsSection
        :meeting-id="props.meetingId"
        :busy="updateSettings.isPending || meetingDoc.isFetching"
        :refresh="meetingDoc.refetch"
        :globally-enabled="globalE2EEEnabled"
      />
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { debounce, SettingsRow, Switch, toast } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import { useChatStore } from '@/apps/meet/composables/useChatStore'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

import E2EESettingsSection from './E2EESettingsSection.vue'

const props = defineProps({
  meetingId: {
    type: String,
    required: true,
  },
})

const meetingDoc = useQuery(api.meet.rooms.get, () => ({ name: props.meetingId }))
const updateSettings = useMutation(api.meet.rooms.updateSettings, { silent: true })
const globalE2EEEnabled = computed(() => Boolean(meetingDoc.data?.e2ee_enabled))

const chatStore = useChatStore()

const allowGuest = ref(false)
const meetingType = ref<'open' | 'restricted'>('open')
const hostOnlyChat = ref<boolean>(chatStore.hostOnlyChat)

const requireHostApproval = computed({
  get: () => meetingType.value === 'restricted',
  set: (enabled: boolean) => {
    meetingType.value = enabled ? 'restricted' : 'open'
  },
})

let syncingFromDocument = false
watch(
  () => meetingDoc.data,
  (doc) => {
    if (!doc) return
    syncingFromDocument = true
    allowGuest.value = Boolean(doc.allow_guest)
    meetingType.value = doc.meeting_type || 'open'
    hostOnlyChat.value = Boolean(doc.host_only_chat)
    syncingFromDocument = false
  },
  { immediate: true },
)

const saveSettings = debounce(async () => {
  if (updateSettings.isPending) return

  try {
    await updateSettings.run({
      name: props.meetingId,
      allow_guest: allowGuest.value,
      meeting_type: meetingType.value,
      host_only_chat: hostOnlyChat.value,
    })

    await meetingDoc.refetch()
  } catch (error) {
    console.error('Failed to update meeting settings:', error)
    toast.error('Failed to update meeting settings')

    if (meetingDoc.data?.host_only_chat !== undefined) {
      hostOnlyChat.value = !!meetingDoc.data.host_only_chat
    }
  }
}, 300)

watch(hostOnlyChat, (newValue) => {
  chatStore.hostOnlyChat = newValue
})
watch(
  [allowGuest, meetingType, hostOnlyChat],
  () => {
    if (!syncingFromDocument && !meetingDoc.isFetching) {
      saveSettings()
    }
  },
  { flush: 'sync' },
)
</script>
