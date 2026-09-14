<template>
  <!-- Opens the statistics page: the sidebar block is the glance, that is the detail. -->
  <SidebarStorage
    v-if="!storageBar.loading"
    class="cursor-pointer hover:bg-surface-gray-2"
    :used-percentage
    :label
    :collapsed="!isExpanded"
    @click="emitter.emit('showSettings', 'statistics')"
  />
</template>

<script setup>
import { computed, inject } from 'vue'
import SidebarStorage from '@/components/SidebarStorage.vue'
import { formatSize, base2BlockSize } from '@/apps/drive/utils/format'
import { storageBar } from '@/apps/drive/resources/files'

const emitter = inject('emitter')

const props = defineProps(['isExpanded'])

const storageMax = computed(() => storageBar.data.limit || 5368709120)

const usedPercentage = computed(() => (100 * (storageBar.data.total_size || 0)) / storageMax.value)

const label = computed(
  () => formatSize(storageBar.data.total_size || 0) + ' used out of ' + base2BlockSize(storageMax.value),
)

storageBar.fetch()
</script>
