<!--
  An app the suite names but this prototype does not build.

  It is a real screen rather than a dead sidebar row: the app list is part of
  what is being tested, so every row has to go somewhere and say why it stops
  there.
-->
<template>
  <PageHeader v-if="!isMobile">
    <div class="text-xl font-semibold text-ink-gray-9">{{ app.label }}</div>
  </PageHeader>
  <PageHeaderMobile v-else :title="app.label" />

  <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
    <div class="rounded-full bg-surface-gray-2 p-3 text-ink-gray-5">
      <span :class="[app.icon, 'size-6']" aria-hidden="true" />
    </div>
    <p class="text-base text-ink-gray-7">{{ app.label }} is not built in this prototype</p>
    <p class="max-w-84 text-p-sm text-ink-gray-5">
      It sits in the app list so the shell can be judged at full length. Drive, Mail and
      Calendar are the working ones.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PageHeader, PageHeaderMobile } from 'frappe-ui'

import { ALL_APPS, HOME_APP } from '../fixtures'
import { isMobile } from '../useIsMobile'
import { useShellNav } from '../useShellNav'

const { area } = useShellNav()

const app = computed(() => ALL_APPS.find((item) => item.id === area.value) ?? HOME_APP)
</script>
