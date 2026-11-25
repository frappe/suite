<!-- On a phone, a page of an app of its own (Mail) leads back to that app, not to the Suite. -->
<template>
  <div class="flex h-full flex-col items-center justify-center gap-3 p-8">
    <h1 class="text-2xl-semibold text-ink-gray-9">{{ __('Page not found') }}</h1>
    <router-link :to="home.to" class="text-sm text-ink-blue-link hover:underline">
      {{ home.label }}
    </router-link>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'
import { isMobile } from '@/shell/useIsMobile'

const props = defineProps<{ phoneApp?: { to: string; label: () => string } }>()

const home = computed(() =>
  isMobile.value && props.phoneApp
    ? { to: props.phoneApp.to, label: __('Back to {0}', [props.phoneApp.label()]) }
    : { to: '/suite', label: __('Back to launcher') },
)
</script>
