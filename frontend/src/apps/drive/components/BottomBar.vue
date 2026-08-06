<template>
  <MobileNav>
    <MobileNavItem
      v-for="tab in sidebarItems"
      :key="tab.label"
      :label="tab.label"
      :icon="tab.icon"
      :to="tab.route"
      :active="tab.highlight()"
    />
  </MobileNav>
</template>
<script>
import { MobileNav, MobileNavItem } from 'frappe-ui'
import LucideClock from '~icons/lucide/clock'
import LucideHome from '~icons/lucide/home'
import LucideStar from '~icons/lucide/star'
import LucideBuilding2 from '~icons/lucide/building-2'
import { getRootSection } from '@/apps/drive/data/breadcrumbs'
import { rootInfo } from '@/apps/drive/resources/files'

export default {
  name: 'BottomBar',
  components: { MobileNav, MobileNavItem },
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
