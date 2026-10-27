<template>
  <!-- The infinite list's row count and manual continuation fallback. -->
  <div
    ref="footer"
    class="text-ink-gray-5 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t text-sm"
    :class="flush ? '-mb-5 px-1 pb-4 pt-2' : 'px-5 py-2'"
  >
    <span>{{ __('{0} of {1}', [String(count), String(total)]) }}</span>
    <Button
      v-if="hasMore"
      size="sm"
      :label="__('Load More')"
      :loading="loading"
      @click="emit('loadMore')"
    />
  </div>
</template>

<script setup lang="ts">
import { useIntersectionObserver } from '@vueuse/core'
import { Button } from 'frappe-ui'
import { ref, useTemplateRef, watch } from 'vue'

const {
  count,
  flush = true,
  hasMore,
  loading = false,
} = defineProps<{
  count: number
  total: number
  hasMore: boolean
  loading?: boolean
  // At the bottom of a page the footer sits flush against the edge; inside a card it does not.
  flush?: boolean
}>()
const emit = defineEmits<{ loadMore: [] }>()

// Infinite scroll: reaching the footer loads the next page, as Load More does. When a page
// lands and the footer is still in view (a short page), the next one loads too.
const footer = useTemplateRef<HTMLElement>('footer')
const inView = ref(false)
// The count when the last automatic load started. A load that adds nothing (it failed) stops
// automatic loading until the footer leaves the view and comes back; Load More still works.
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
