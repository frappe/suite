<!--
  The settings list on a phone: one card per heading, one row per tab. The
  Settings drill-in and the Mail and Calendar Profile pages show it, so both
  lists stay the same.
-->
<template>
  <template v-if="groups">
    <section v-for="group in shown" :key="group.label" :aria-label="group.label">
      <div class="px-1 pb-1.5 text-sm text-ink-gray-5">{{ group.label }}</div>
      <div class="divide-y divide-outline-gray-1 overflow-hidden rounded-6 bg-surface-gray-1">
        <button
          v-for="tab in group.tabs"
          :key="tab.id"
          type="button"
          class="flex w-full items-center gap-3 p-3 text-base active:bg-surface-gray-2"
          @click="emit('open', tab)"
        >
          <Avatar
            v-if="tab.id === PROFILE_TAB"
            :image="avatar ?? undefined"
            :label="fullName"
            size="xs"
            class="shrink-0"
            aria-hidden="true"
          />
          <span v-else :class="[tab.icon, 'size-4 shrink-0 text-ink-gray-6']" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-left text-ink-gray-8">{{ tab.label() }}</span>
          <span class="lucide-chevron-right size-4 shrink-0 text-ink-gray-4" aria-hidden="true" />
        </button>
      </div>
    </section>
    <SettingsLoadFailed
      v-if="failed"
      class="rounded-6 bg-surface-gray-1 p-3"
      :retry="retry"
    />
  </template>
  <div v-else class="flex min-h-0 flex-1 items-center justify-center py-8" role="status" :aria-label="__('Loading')">
    <LoadingIndicator class="size-5 text-ink-gray-5" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Avatar, LoadingIndicator } from 'frappe-ui'

import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import SettingsLoadFailed from '@/shell/settings/SettingsLoadFailed.vue'
import type { SettingsTab, VisibleSettingsGroup } from '@/shell/settings/settings'

const PROFILE_TAB = 'account.profile'

const props = defineProps<{
  groups: readonly VisibleSettingsGroup[] | null
  failed: number
  retry: () => Promise<void>
  /** Tab ids to leave out, for example Profile under an identity card. */
  exclude?: readonly string[]
}>()
const emit = defineEmits<{ open: [tab: SettingsTab] }>()

const session = useSession()
const fullName = computed(() => session.user.value?.fullName ?? '')
const avatar = computed(() => session.user.value?.avatar ?? null)

const shown = computed(() =>
  (props.groups ?? [])
    .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => !props.exclude?.includes(tab.id)) }))
    .filter((group) => group.tabs.length > 0),
)
</script>
