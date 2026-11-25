<!--
  Shown when a page's code failed to load: the connection dropped, or the tab
  is older than the last deploy. Reload loads the page it was opening afresh.
  The router imports this view eagerly, so it shows when no chunk can load.
  On a phone, a page of an app of its own (Mail) leads to that app as its Home, not to the Suite.
-->
<template>
  <StatusPage
    role="alert"
    :title="__('This page did not load')"
    :description="__('Check your connection, then reload the page.')"
  >
    <Button variant="solid" @click="reload">{{ __('Reload') }}</Button>
    <Button variant="ghost" @click="goHome">{{ __('Go to Home') }}</Button>
  </StatusPage>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { translate as __ } from '@/platform/translation'
import StatusPage from '@/shell/StatusPage.vue'
import { isMobile } from '@/shell/useIsMobile'

const props = defineProps<{ phoneHome?: string }>()

const route = useRoute()

// On a phone, an app of its own is its own Home.
const home = computed(() => (isMobile.value && props.phoneHome) || '/home')

// Only a path on this site: the query is part of a URL anyone can send.
function reload() {
  const target = route.query.redirect
  const path = typeof target === 'string' && /^\/(?!\/)/.test(target) ? target : '/home'
  window.location.assign(path)
}

// A page load, not the router: the code this page could not load may be the router's next page.
function goHome() {
  window.location.assign(home.value)
}
</script>
