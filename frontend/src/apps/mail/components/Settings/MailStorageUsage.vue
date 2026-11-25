<!--
  How much of its quota the Mail account holds: Mail's part of the Storage tab, laid out as
  Drive's total is beside it.
-->
<template>
  <div v-if="quota.data" class="flex flex-col gap-2">
    <Progress
      :value="isLimited ? Math.min(100, Math.round(usedPercentage)) : 0"
      size="md"
      :aria-label="__('Mail storage used')"
    />
    <p class="text-ink-gray-7 text-base">{{ label }}</p>
  </div>
</template>

<script setup lang="ts">
import { Progress } from 'frappe-ui'

import { useQuota } from '@/apps/mail/composables/useQuota'
import { translate as __ } from '@/platform/translation'

const { quota, isLimited, usedPercentage, label } = useQuota()
</script>
