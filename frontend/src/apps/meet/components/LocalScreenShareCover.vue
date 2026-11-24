<template>
  <div
    class="absolute inset-0 flex flex-col items-center justify-center bg-black/40 px-3 text-center text-white"
    :class="{ 'backdrop-blur-md': !videoAlreadyBlurred }"
  >
    <MonitorUp aria-hidden="true" class="mb-6 size-8 shrink-0" />
    <div v-if="showCopy" class="mb-1 text-lg-medium">
      {{ __('You are sharing your screen') }}
    </div>
    <div v-if="showCopy" class="text-sm-medium">
      {{ __('Everyone else can see what you are presenting') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { MonitorUp } from 'lucide-vue-next'

import { translate as __ } from '@/platform/translation'

defineProps<{ showCopy: boolean; videoAlreadyBlurred?: boolean }>()
</script>
