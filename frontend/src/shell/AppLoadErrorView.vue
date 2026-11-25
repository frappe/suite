<!--
  Shown when a page's code failed to load: the connection dropped, or the tab
  is older than the last deploy. Reload loads the page it was opening afresh.
  The router imports this view eagerly, so it shows when no chunk can load.
  On a phone, a page of an app of its own (Mail) leads back to that app, not to the Suite.
-->
<template>
  <StatusPage
    role="alert"
    icon="lucide-cloud-off"
    :title="__('This page did not load')"
    :description="__('Check your connection, then reload the page.')"
  >
    <Button variant="solid" size="md" @click="reload">{{ __('Reload') }}</Button>
    <Button variant="subtle" size="md" @click="goHome">{{ home.label }}</Button>
  </StatusPage>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { translate as __ } from '@/platform/translation'
import StatusPage from '@/shell/StatusPage.vue'
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

// A page load, not the router: the code this page could not load may be the router's next page.
function goHome() {
  window.location.assign(home.value.to)
}
</script>
