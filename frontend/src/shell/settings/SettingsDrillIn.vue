<!--
  Settings on a phone: a full-screen list of headings and rows. A row opens
  its tab as a full-screen page over the list.

  It is a modal dialog: focus stays inside it, and the page behind it is
  hidden from assistive technology.

  Each level owns one browser history entry, so the back gesture goes tab,
  then list, then closed. The on-screen back arrows and Escape call
  history.back() and take the same path. Every entry carries the id of the
  open it belongs to, so an entry from an earlier open closes Settings.
-->
<template>
  <DialogRoot :open="open" @update:open="(value) => !value && back()">
    <DialogPortal>
      <DialogContent
        class="fixed inset-0 z-40 flex flex-col bg-surface-base pt-[env(safe-area-inset-top)] outline-none"
        :aria-describedby="undefined"
        @escape-key-down.prevent="back"
        @pointer-down-outside.prevent
        @focus-outside.prevent
      >
        <div class="flex h-14 shrink-0 items-center border-b px-3">
          <Button
            variant="ghost"
            icon="lucide-chevron-left"
            class="-ml-2 mr-2 shrink-0"
            :aria-label="__('Close settings')"
            @click="back"
          />
          <DialogTitle class="min-w-0 flex-1 truncate text-xl font-semibold text-ink-gray-9">
            {{ __('Settings') }}
          </DialogTitle>
        </div>

        <div
          class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
          :inert="page ? true : undefined"
        >
          <SettingsList :groups="groups" :failed="failed" :retry="retry" @open="openTab" />
        </div>

        <Transition
          enter-active-class="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
          enter-from-class="translate-x-full"
          leave-active-class="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
          leave-to-class="translate-x-full"
        >
          <div
            v-if="page"
            class="absolute inset-0 z-10 flex flex-col bg-surface-base pt-[env(safe-area-inset-top)]"
            role="region"
            :aria-label="page.label()"
          >
            <div class="flex h-14 shrink-0 items-center border-b px-3">
              <Button
                variant="ghost"
                icon="lucide-chevron-left"
                class="-ml-2 mr-2 shrink-0"
                :aria-label="__('Back')"
                @click="back"
              />
              <h2 class="min-w-0 flex-1 truncate text-xl font-semibold text-ink-gray-9">
                {{ page.label() }}
              </h2>
              <!-- Tab header actions teleport here, so they leave with the page. -->
              <div :id="SETTINGS_PAGE_ACTIONS_ID" class="flex shrink-0 items-center gap-2" />
            </div>
            <div
              class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]"
            >
              <SettingsTabBody :tab="page" />
            </div>
          </div>
        </Transition>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { DialogContent, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { onBeforeUnmount, onMounted, provide, shallowRef, watch } from 'vue'

import { translate as __ } from '@/platform/translation'
import {
  SETTINGS_PAGE_ACTIONS_ID,
  SETTINGS_PHONE_PAGE,
  type SettingsTab,
  type VisibleSettingsGroup,
} from '@/shell/settings/settings'
import SettingsList from '@/shell/settings/SettingsList.vue'
import SettingsTabBody from '@/shell/settings/SettingsTabBody.vue'

const props = defineProps<{
  groups: readonly VisibleSettingsGroup[] | null
  failed: number
  retry: () => Promise<void>
  /** The tab to open over the list once the groups resolve. */
  tab?: string
}>()
const open = defineModel<boolean>('open', { default: false })

provide(SETTINGS_PHONE_PAGE, true)

type Level = 'list' | 'tab'
interface EntryState {
  suiteSettings?: Level
  suiteSettingsTab?: string
  /** The open this entry belongs to. */
  suiteSettingsOpen?: string
}

const page = shallowRef<SettingsTab | null>(null)
// The history entries this open pushed and has not yet left.
let depth = 0
// A new id each time Settings opens.
let openId = ''
// A tab asked for before the groups resolved.
let pendingTab: string | undefined

function findTab(id: string | undefined): SettingsTab | undefined {
  return props.groups?.flatMap((group) => group.tabs).find((tab) => tab.id === id)
}

function push(state: EntryState) {
  // Keep the router's own state, so vue-router sees the same position and
  // treats a pop between these entries as a no-op.
  history.pushState(
    { ...(history.state as object | null), ...state, suiteSettingsOpen: openId },
    '',
  )
  depth += 1
}

function openTab(tab: SettingsTab) {
  page.value = tab
  push({ suiteSettings: 'tab', suiteSettingsTab: tab.id })
}

function openPending() {
  if (!props.groups) return
  const tab = findTab(pendingTab)
  pendingTab = undefined
  if (tab) openTab(tab)
}

function back() {
  if (depth > 0) history.back()
  else open.value = false
}

function onPopState(event: PopStateEvent) {
  if (!open.value) return
  const state = (event.state ?? {}) as EntryState
  if (state.suiteSettingsOpen === openId && state.suiteSettings === 'tab') {
    depth = 2
    page.value = findTab(state.suiteSettingsTab) ?? null
  } else if (state.suiteSettingsOpen === openId && state.suiteSettings === 'list') {
    depth = 1
    page.value = null
  } else {
    // Below the list, or an entry an earlier open left behind.
    depth = 0
    page.value = null
    open.value = false
  }
}

watch(
  open,
  (isOpen) => {
    if (isOpen) {
      if (depth > 0) return
      openId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      push({ suiteSettings: 'list' })
      pendingTab = props.tab
      openPending()
    } else {
      page.value = null
      pendingTab = undefined
      // Closed from outside the drill-in: drop the entries it pushed. The
      // pops arrive while closed, so onPopState ignores them.
      if (depth > 0) history.go(-depth)
      depth = 0
    }
  },
  { immediate: true },
)

watch(
  () => props.groups,
  () => {
    if (open.value && pendingTab) openPending()
  },
)

onMounted(() => window.addEventListener('popstate', onPopState))
onBeforeUnmount(() => window.removeEventListener('popstate', onPopState))
</script>
