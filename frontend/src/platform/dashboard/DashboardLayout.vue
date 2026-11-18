<template>
  <div class="flex h-full flex-col">
    <PageHeader>
      <div class="flex min-w-0 items-center">
        <Button
          v-if="isMobile"
          icon="lucide-menu"
          variant="ghost"
          :aria-label="__('Open navigation')"
          @click="openAreaSidebar(sidebarArea)"
        />
        <!-- Lines the title's text up with the body's left edge; the crumb's own 2px padding is pulled
           back on desktop, and the phone keeps a gap after its menu button. -->
        <Breadcrumbs :items="breadcrumbs" class="mr-2" :class="isMobile ? 'ml-2' : '-ml-0.5'" />
        <Badge v-if="badgeLabel && !loading" :label="badgeLabel" :theme="badgeTheme" />
      </div>
      <div class="ml-auto flex shrink-0 space-x-2">
        <slot v-if="!loading" name="actions">
          <Button
            v-if="buttonLabel"
            :label="buttonLabel"
            icon-left="lucide-plus"
            @click="buttonAction"
          />
        </slot>
      </div>
    </PageHeader>
    <!-- min-h-0 lets the body shrink to the viewport and scroll itself, which is what the
		     sticky list footer relies on; without it the body grows and the outer page scrolls. -->
    <div
      class="flex min-h-0 flex-1 flex-col overflow-y-auto"
      :aria-busy="loading"
      :class="{ 'space-y-5 px-3 py-5 sm:px-5': !removeSpacing }"
    >
      <!-- While the page resource loads, keep the chrome (header, breadcrumbs)
			     and show a placeholder body instead of a blank pane. -->
      <slot v-if="loading" name="loading">
        <DashboardListSkeleton />
      </slot>
      <slot v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Badge, Breadcrumbs, Button, PageHeader } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useScreenSize } from '@/composables/useScreenSize'
import { openAreaSidebar } from '@/platform/area-sidebar'
import { translate as __ } from '@/platform/translation'

import DashboardListSkeleton from './DashboardListSkeleton.vue'

const {
  area,
  removeSpacing = false,
  loading = false,
} = defineProps<{
  /** The area whose sidebar the phone's menu button opens. */
  area: string
  breadcrumbs: { label: string; route?: string }[]
  buttonLabel?: string
  buttonAction?: () => void
  badgeLabel?: string
  badgeTheme?: 'green' | 'red' | 'gray' | 'amber' | 'blue' | 'violet'
  removeSpacing?: boolean
  loading?: boolean
}>()

const { isMobile } = useScreenSize()
const route = useRoute()
const sidebarArea = computed(() => route.meta.area ?? area)
</script>
