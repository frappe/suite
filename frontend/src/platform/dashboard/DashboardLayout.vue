<template>
  <div class="flex h-full flex-col">
    <header class="flex items-center border-b px-3 py-2.5 sm:px-5">
      <Button
        v-if="isMobile"
        icon="lucide-menu"
        variant="ghost"
        @click="openAreaSidebar(sidebarArea)"
      />
      <Breadcrumbs :items="breadcrumbs" class="mx-2" />
      <Badge v-if="badgeLabel && !loading" :label="badgeLabel" :theme="badgeTheme" />
      <div class="ml-auto flex space-x-2">
        <slot v-if="!loading" name="actions">
          <Button
            v-if="buttonLabel"
            :label="buttonLabel"
            icon-left="lucide-plus"
            @click="buttonAction"
          />
        </slot>
      </div>
    </header>
    <!-- min-h-0 lets the body shrink to the viewport and scroll itself, which is what the
		     sticky list footer relies on; without it the body grows and the outer page scrolls. -->
    <div
      class="flex min-h-0 flex-1 flex-col overflow-y-auto"
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
import { Badge, Breadcrumbs, Button } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useScreenSize } from '@/composables/useScreenSize'
import { openAreaSidebar } from '@/platform/area-sidebar'

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
