<template>
  <span
    class="relative mr-3 flex size-4 shrink-0 items-center justify-center"
  >
    <img
      :src="thumbnail.fallback"
      alt=""
      class="size-4 rounded-1"
      :class="hasThumbnail && loaded ? 'opacity-0' : 'opacity-100'"
      draggable="false"
    />
    <img
      v-if="hasThumbnail"
      :src="thumbnail.src"
      alt=""
      class="absolute inset-0 size-4 rounded-1 object-cover"
      :class="loaded ? 'opacity-100' : 'opacity-0'"
      draggable="false"
      @load="loaded = true"
    />
  </span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { getThumbnailUrl } from '@/apps/drive/utils/files'

const props = defineProps<{ entity: Record<string, unknown> }>()
const loaded = ref(false)
const thumbnail = computed(() => getThumbnailUrl(props.entity))
const hasThumbnail = computed(() => thumbnail.value.src !== thumbnail.value.fallback)
</script>
