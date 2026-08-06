<template>
  <div
    class="grid grid-cols-5 bg-surface-elevation-2 border-t border-outline-gray-2 standalone:pb-4"
    :style="{
      gridTemplateColumns: `repeat(${sidebarItems.length}, minmax(0, 1fr))`,
    }"
  >
    <button
      v-for="tab in sidebarItems"
      :key="tab.label"
      :aria-label="tab.label"
      class="flex flex-col items-center justify-center transition active:scale-95 h-[50px]"
      @click="$router.push(tab.route)"
    >
      <component
        :is="tab.icon"
        class="size-6"
        :class="[tab.highlight() ? 'text-ink-gray-8' : 'text-ink-gray-5']"
      />
    </button>
  </div>
</template>
<script>
import LucideClock from '~icons/lucide/clock'
import LucideHome from '~icons/lucide/home'
import LucideStar from '~icons/lucide/star'
import LucideBuilding2 from '~icons/lucide/building-2'
import { getRootSection } from '@/apps/drive/data/breadcrumbs'
import { rootInfo } from '@/apps/drive/resources/files'

export default {
  name: 'BottomBar',
  computed: {
    sidebarItems() {
      const first = getRootSection()
      return [
        {
          label: 'Home',
          route: { name: 'drive-Home' },
          icon: LucideHome,
          highlight: () => first.name === 'drive-Home',
        },
        {
          label: 'Recents',
          route: { name: 'drive-Recents' },
          icon: LucideClock,
          highlight: () => first.name === 'drive-Recents',
        },
        {
          label: 'Everyone',
          route: rootInfo.data
            ? { name: 'drive-Folder', params: { entityName: rootInfo.data.root } }
            : { name: 'drive-Home' },
          icon: LucideBuilding2,
          highlight: () => first.name === rootInfo.data?.root,
        },
        {
          label: 'Favourites',
          route: { name: 'drive-Favourites' },
          icon: LucideStar,
          highlight: () => first.name === 'drive-Favourites',
        },
      ]
    },
  },
}
</script>
