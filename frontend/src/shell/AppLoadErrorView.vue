<!--
  Shown when a page's code failed to load: the connection dropped, or the tab
  is older than the last deploy. Reload loads the page it was opening afresh.
  The router imports this view eagerly, so it shows when no chunk can load.
  On a phone, a page of an app of its own (Mail) leads back to that app, not to the Suite.
-->
<template>
  <section
    role="alert"
    class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
    aria-labelledby="load-error-title"
  >
    <span class="lucide-cloud-off size-10 text-ink-gray-5" aria-hidden="true" />
    <div class="flex flex-col gap-1.5">
      <h1 id="load-error-title" class="text-2xl-semibold text-ink-gray-9">
        {{ __('This page did not load') }}
      </h1>
      <p class="text-p-base text-ink-gray-6">
        {{ __('Check your connection, then reload the page.') }}
      </p>
    </div>
    <div class="flex items-center gap-3">
      <Button variant="solid" @click="reload">{{ __('Reload') }}</Button>
      <a :href="home.to" class="text-sm text-ink-gray-6 hover:underline">{{ home.label }}</a>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { translate as __ } from '@/platform/translation'
import { isMobile } from '@/shell/useIsMobile'

const props = defineProps<{ phoneApp?: { to: string; label: () => string } }>()

const route = useRoute()

const home = computed(() =>
  isMobile.value && props.phoneApp
    ? { to: props.phoneApp.to, label: __('Go to {0}', [props.phoneApp.label()]) }
    : { to: '/home', label: __('Go to Home') },
)

// Only a path on this site: the query is part of a URL anyone can send.
function reload() {
  const target = route.query.redirect
  const path = typeof target === 'string' && /^\/(?!\/)/.test(target) ? target : '/home'
  window.location.assign(path)
}
</script>
