<template>
  <!-- The offer to install the app whose page this is, as a slim strip just above the bottom bar:
       in the page's flow, so it covers nothing, and only where the bottom bar is. Under a bar that
       floats, a card at the foot of the screen that the bar stands on. Shown once per
       app and device until dismissed (see platform/pwa/install). Inside the one Suite app
       installed before the split, a note in the same place says once that Mail and Calendar are
       apps of their own. -->
  <!-- Inside an installed app, the first time it opens: whether to be notified. A button, not the
       browser's prompt on load: an iPhone lets a page ask only from a tap. -->
  <div
    v-if="ask"
    class="text-p-sm text-ink-gray-8 flex items-center gap-3"
    :class="look"
    role="region"
    :aria-label="__('Notifications')"
  >
    <!-- The icon with the words, on their first line; the two centred in the strip together, as
         its buttons are taller than one line. -->
    <div class="flex min-w-0 flex-1 items-start gap-3">
      <span class="lucide-bell text-ink-gray-5 mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p class="min-w-0 flex-1">{{ __('Be notified by {0} on this device?', [label]) }}</p>
    </div>
    <Button variant="solid" :label="__('Turn on')" @click="turnOn" />
    <Button variant="ghost" class="shrink-0" :aria-label="__('Dismiss')" @click="push.dismissAsk()">
      <template #icon><span class="lucide-x text-ink-gray-6 size-4" aria-hidden="true" /></template>
    </Button>
  </div>
  <div
    v-else-if="note || offer"
    class="text-p-sm text-ink-gray-8 flex items-center gap-3"
    :class="look"
    role="region"
    :aria-label="note ? __('Apps of their own') : __('Install {0}', [label])"
  >
    <!-- The icon with the words, as above. -->
    <div class="flex min-w-0 flex-1 items-start gap-3">
      <span
        :class="note ? 'lucide-layout-grid' : 'lucide-download'"
        class="text-ink-gray-5 mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <p v-if="note" class="min-w-0 flex-1">
        {{
          __('Mail and Calendar are apps of their own now: open one in your browser to install it.')
        }}
      </p>
      <p v-else-if="how === 'steps'" class="min-w-0 flex-1">
        {{ __('Install {0}: tap', [label]) }}
        <span class="lucide-share size-4 inline-block align-[-3px]" :aria-label="__('Share')" />
        {{ __('then Add to Home Screen.') }}
      </p>
      <p v-else class="min-w-0 flex-1">{{ __('Install {0} as an app.', [label]) }}</p>
    </div>
    <Button
      v-if="!note && how === 'prompt'"
      variant="solid"
      :label="__('Install')"
      @click="install"
    />
    <Button
      variant="ghost"
      class="shrink-0"
      :aria-label="__('Dismiss')"
      @click="note ? dismissSuiteAppNote() : dismiss()"
    >
      <template #icon><span class="lucide-x text-ink-gray-6 size-4" aria-hidden="true" /></template>
    </Button>
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import type { AreaDefinition } from '@/platform/contracts'
import { toast } from '@/platform/feedback'
import { useDevicePush, useInstallOffer } from '@/platform/pwa'
import { translate as __ } from '@/platform/translation'

const props = defineProps<{
  /** The area of the page, when it installs as an app of its own. */
  app?: AreaDefinition
  /** Under a bottom bar that floats over the page: a card that floats with it, not a strip. */
  floating?: boolean
}>()

const look = computed(() =>
  props.floating
    ? 'bg-surface-elevation-2 pointer-events-auto mx-4 mb-[calc(0.75rem+env(safe-area-inset-bottom))] rounded-7 border py-2 pl-4 pr-2 shadow-xl'
    : 'bg-surface-gray-1 border-t px-4 py-2',
)

const route = useRoute()
const {
  app: linkedApp,
  how,
  bannerOpen,
  install,
  dismiss,
  suiteAppNote,
  dismissSuiteAppNote,
} = useInstallOffer()

const label = computed(() => props.app?.label() ?? '')
// The offer is for the app this page installs as, on that app's own pages.
const offer = computed(
  () =>
    !!props.app &&
    props.app.id === linkedApp.value &&
    route.meta.frame !== 'none' &&
    bannerOpen.value,
)
const note = computed(() => suiteAppNote.value)

const push = useDevicePush()
const ask = computed(() => !!props.app && props.app.id === linkedApp.value && push.askOpen.value)
const turnOn = async () => {
  try {
    if (!(await push.enable()))
      toast.error(__('Notifications are blocked for this site in the browser settings'))
  } catch {
    toast.error(__('Could not enable notifications'))
  }
}
</script>
