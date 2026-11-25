<!-- On a phone, a page of an app of its own (Mail) leads back to that app, not to the Suite. -->
<template>
  <StatusPage
    :title="__('Page not found')"
    :description="__('The link may be wrong, or the page may have moved.')"
  >
    <Button variant="solid" :route="home.to">{{ home.label }}</Button>
  </StatusPage>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'
import StatusPage from '@/shell/StatusPage.vue'
import { isMobile } from '@/shell/useIsMobile'

const props = defineProps<{ phoneApp?: { to: string; label: () => string } }>()

const home = computed(() =>
  isMobile.value && props.phoneApp
    ? { to: props.phoneApp.to, label: __('Go to {0}', [props.phoneApp.label()]) }
    : { to: '/suite', label: __('Go to launcher') },
)
</script>
