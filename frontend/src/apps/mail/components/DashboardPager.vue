<template>
  <div ref="footer" class="h-px shrink-0" aria-hidden="true" />
</template>

<script setup lang="ts">
import { useIntersectionObserver } from '@vueuse/core'
import { ref, useTemplateRef, watch } from 'vue'

const {
  count,
  hasMore,
  loading = false,
} = defineProps<{
  count: number
  hasMore: boolean
  loading?: boolean
}>()
const emit = defineEmits<{ loadMore: [] }>()

// Infinite scroll: reaching the footer loads the next page. When a page
// lands and the footer is still in view (a short page), the next one loads too.
const footer = useTemplateRef<HTMLElement>('footer')
const inView = ref(false)
// The count when the last automatic load started. A load that adds nothing (it failed) stops
// automatic loading until the footer leaves the view and comes back.
let requestedAt: number | null = null
useIntersectionObserver(
  footer,
  ([entry]) => {
    inView.value = entry?.isIntersecting ?? false
    if (!inView.value) requestedAt = null
  },
  { rootMargin: '200px' },
)
watch(
  () => inView.value && hasMore && !loading,
  (ready) => {
    if (!ready || requestedAt === count) return
    requestedAt = count
    emit('loadMore')
  },
)
</script>
