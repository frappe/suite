<!--
  The in-call and preview Settings dialog: Controls for a host, then Meet's
  settings tabs. Meet has no group in the Suite Settings dialog, so this is
  the only place these tabs live.
-->
<template>
  <SettingsDialog v-model:open="open" v-model:tab="activeTab" size="5xl" :keyboard-shortcut="false">
    <template #title>{{ __('Meeting settings') }}</template>
    <SettingsSidebar>
      <SettingsNavGroup v-if="canManageMeeting" :label="__('Meeting')">
        <SettingsNavItem :value="CONTROLS_TAB">
          <template #prefix>
            <span class="lucide-user text-ink-gray-6 size-4 shrink-0" aria-hidden="true" />
          </template>
          {{ __('Controls') }}
        </SettingsNavItem>
      </SettingsNavGroup>
      <SettingsNavGroup :label="meetSettings.label()">
        <SettingsNavItem v-for="tab in tabs" :key="tab.id" :value="tab.id">
          <template #prefix>
            <span :class="[tab.icon, 'text-ink-gray-6 size-4 shrink-0']" aria-hidden="true" />
          </template>
          {{ tab.label() }}
        </SettingsNavItem>
      </SettingsNavGroup>
    </SettingsSidebar>
    <SettingsContent>
      <SettingsPanel v-if="canManageMeeting" :value="CONTROLS_TAB">
        <MeetingAccessSettingsTab v-if="meetingId" :meeting-id="meetingId" />
      </SettingsPanel>
      <SettingsPanel v-for="tab in tabs" :key="tab.id" :value="tab.id">
        <component :is="bodies[tab.id]" v-bind="bodyProps(tab.id)" />
      </SettingsPanel>
    </SettingsContent>
  </SettingsDialog>
</template>

<script setup lang="ts">
import {
  LoadingIndicator,
  SettingsContent,
  SettingsDialog,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsPanel,
  SettingsSidebar,
  useDoc,
} from 'frappe-ui'
import { computed, defineAsyncComponent, defineComponent, h, ref, type Component } from 'vue'

import { meetSettings } from '@/apps/meet/settings'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

import MeetingAccessSettingsTab from './MeetingAccessSettingsTab.vue'

type MeetTabId = (typeof meetSettings.tabs)[number]['id']

const CONTROLS_TAB = 'meeting-access'
// The media tabs report a device switch, so the call can apply it.
const DEVICE_TABS: readonly MeetTabId[] = ['meet.devices', 'meet.audio', 'meet.video']

const props = defineProps<{
  meetingId?: string
  isPreview?: boolean
}>()

// What DeviceSettingsTab emits when the person picks a device.
type DeviceChange = { type: string; deviceId: string }

const emit = defineEmits<{
  'device-changed': [event: DeviceChange]
}>()

const open = defineModel<boolean>('open', { default: false })
const activeTab = ref<string>('meet.devices')

const session = useSession()

const meetingDoc = useDoc<{
  name: string
  owner?: string
  co_hosts?: { user: string }[]
}>({
  doctype: 'Meet Room',
  name: () => props.meetingId || '',
})

const canManageMeeting = computed(() => {
  const user = session.user.value?.id
  if (props.isPreview || !user) return false
  return (
    meetingDoc.doc?.owner === user ||
    Boolean(meetingDoc.doc?.co_hosts?.some((row) => row.user === user))
  )
})

// Layout arranges the call grid, so the preview has no use for it.
const tabs = computed(() =>
  meetSettings.tabs.filter((tab) => !(props.isPreview && tab.id === 'meet.layout')),
)

// The same loading and error states as the Suite Settings tab bodies. Meet
// may not import the shell, so they are drawn here.
const Loading = defineComponent({
  name: 'MeetSettingsTabLoading',
  setup: () => () =>
    h(
      'div',
      {
        class: 'flex min-h-0 flex-1 items-center justify-center',
        role: 'status',
        'aria-label': __('Loading'),
      },
      h(LoadingIndicator, { class: 'size-5 text-ink-gray-5' }),
    ),
})

const Failed = defineComponent({
  name: 'MeetSettingsTabFailed',
  setup: () => () =>
    h(
      'div',
      { class: 'flex min-h-0 flex-1 items-center justify-center px-6 text-center' },
      h(
        'p',
        { class: 'text-p-base text-ink-gray-6' },
        __('This tab could not load. Reload the page and try again.'),
      ),
    ),
})

const bodies = Object.fromEntries(
  meetSettings.tabs.map((tab) => [
    tab.id,
    defineAsyncComponent({
      loader: tab.body,
      loadingComponent: Loading,
      errorComponent: Failed,
      delay: 0,
    }),
  ]),
) as Record<MeetTabId, Component>

// The props a tab body takes. Only the video tab and the device tabs take any.
type TabBodyProps = {
  isVisible?: boolean
  onDeviceChanged?: (event: DeviceChange) => void
}

function bodyProps(id: MeetTabId): TabBodyProps {
  return {
    ...(id === 'meet.video' ? { isVisible: open.value && activeTab.value === id } : {}),
    ...(DEVICE_TABS.includes(id)
      ? { onDeviceChanged: (event: DeviceChange) => emit('device-changed', event) }
      : {}),
  }
}
</script>
