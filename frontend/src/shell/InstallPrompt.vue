<template>
  <!-- The offer to install the app whose page this is. Mounted once by the
	     shell on phones and never unmounted, since Chrome fires
	     `beforeinstallprompt` once and a listener that is not there at the time
	     misses it. Shown only on an installable app's pages inside the shell
	     frame: they link that app's manifest (see platform/pwa), and new
	     installs are offered per app, not of the Suite. The manifest is on every
	     route, so Chrome may fire elsewhere; the offer waits for such a page.
	     The iOS hint follows the same gate. -->
  <Dialog :open="showDialog && installable && offered" @update:open="showDialog = $event">
    <template #title>
      <h2 class="text-lg-bold">{{ __('Install {0}', [app?.label() ?? '']) }}</h2>
    </template>
    <template #default>
      <p>{{ __('Get the app on your device for easy access & a better experience!') }}</p>
    </template>
    <template #actions>
      <Button variant="solid" class="w-full py-5" @click="install">
        <template #prefix><FeatherIcon name="download" class="w-4" /></template>
        {{ __('Install') }}
      </Button>
    </template>
  </Dialog>

  <!-- iOS installation info message — a plain fixed banner, not a Popover: no overlay to
	     block the app behind it, and the viewport (not the content) bounds its width.
	     Teleported to body and lifted past z-50: it lives in the app tree, so the
	     body-portaled surfaces (bottom sheets, dialogs — z-50) would otherwise paint
	     their backdrops over it. Those surfaces are modal: reka makes everything
	     outside them inert, and treats a pointer or focus that lands outside as a
	     dismissal. So the banner opts back in to pointer events, and keeps both
	     events to itself so the sheet under it neither ignores the tap nor closes on
	     it — the X closes the banner and only the banner. -->
  <Teleport to="body">
    <div
      v-if="iosInstallMessage && installable"
      class="bg-surface-blue-2 pointer-events-auto fixed inset-x-2 bottom-4 z-[60] flex flex-col gap-3 rounded-4 py-5 drop-shadow-xl"
      @pointerdown.stop
      @focusin.stop
    >
      <div class="mb-1 flex flex-row items-center justify-between px-3 text-center">
        <span class="text-base-bold">
          {{ __('Install {0}', [app?.label() ?? '']) }}
        </span>
        <span class="inline-flex items-baseline">
          <FeatherIcon
            name="x"
            class="text-ink-gray-6 ml-auto h-4 w-4"
            @click="iosInstallMessage = false"
          />
        </span>
      </div>
      <div class="text-ink-gray-7 px-3 text-xs">
        <span class="flex flex-col gap-2">
          <span>
            {{ __('Get the app on your iPhone for easy access & a better experience') }}
          </span>
          <span>
            {{ __('Tap') }}
            <FeatherIcon name="share" class="inline h-4 w-4 align-[-3px] text-blue-600" />
            {{ __('and then "Add to Home Screen"') }}
          </span>
        </span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Button, Dialog } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { computed, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'

import type { AreaDefinition } from '@/platform/contracts'
import { linkedPwaApp } from '@/platform/pwa'

const props = defineProps<{
  /** The area of the page, when it installs as an app of its own. */
  app?: AreaDefinition
}>()

const route = useRoute()
const installable = computed(() => !!props.app && route.meta.frame !== 'none')

// The browser's install event, with the app whose manifest the page linked when it fired: the
// event installs that app, so it is offered only on that app's pages, under that app's name.
const deferred = shallowRef<{ event: BeforeInstallPromptEvent; app: string } | null>(null)
const offered = computed(() => !!props.app && deferred.value?.app === props.app.id)
const showDialog = ref(false)
const iosInstallMessage = ref(false)

const isIos = () => {
  // Detects if device is on iOS
  const userAgent = window.navigator.userAgent.toLowerCase()
  return /iphone|ipad|ipod/.test(userAgent)
}

// Detects if device is in standalone mode
const isInStandaloneMode = () => 'standalone' in window.navigator && window.navigator.standalone

// Checks if should display install popup notification:
if (isIos() && !isInStandaloneMode()) iosInstallMessage.value = true

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault()
  // Stash the event so it can be triggered later.
  deferred.value = { event: e, app: linkedPwaApp.value }
  if (isIos() && !isInStandaloneMode()) iosInstallMessage.value = true
  else showDialog.value = true
})

window.addEventListener('appinstalled', () => {
  showDialog.value = false
  deferred.value = null
})

const install = () => {
  void deferred.value?.event.prompt()
  showDialog.value = false
}
</script>
