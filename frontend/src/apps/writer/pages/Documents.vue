<template>
  <Navbar />
  <div class="flex-grow overflow-y-auto bg-surface-base">
    <RoundedListView v-if="groupedDocuments" :groups="groupedDocuments" :resource="getDocuments" />
    <LoadingIndicator v-else-if="getDocuments.loading" class="size-5 mx-auto mt-32" />
    <ErrorPage v-else error="There was an error fetching the documents." />
  </div>
</template>
<script setup>
import { computed } from 'vue'

import { getDocuments } from '@/apps/writer/resources/'
import RoundedListView from '@/apps/writer/components/RoundedListView.vue'
import Navbar from '@/apps/writer/components/Navbar.vue'
import { LoadingIndicator, usePageMeta } from 'frappe-ui'
import ErrorPage from '@/apps/writer/components/ErrorPage.vue'

const groupedDocuments = computed(() => getDocuments.data && groupByTime(getDocuments.data))
getDocuments.fetch()

usePageMeta(() => ({
  title: 'Writer',
}))

function groupByTime(entities) {
  const today = new Date()
  const grouped = {
    Today: [],
    Yesterday: [],
    'Last seven days': [],
    'Earlier this month': [],
    'Earlier this year': [],
    Earlier: [],
  }
  entities.forEach((k) => {
    // remove complex logic; replace with something smarter?
    const modified = new Date(k.modified)
    const accessed = new Date(k.accessed)
    k.recentDate = accessed
    return k
  })
  entities
    .sort((a, b) => b.recentDate - a.recentDate)
    .forEach((file) => {
      const yearDiff = today.getFullYear() - file.recentDate.getFullYear()
      const monthDiff = today.getMonth() - file.recentDate.getMonth() + yearDiff * 12 // Adjust for year difference
      const dayDiff = Math.floor((today - file.recentDate) / (1000 * 60 * 60 * 24))
      if (dayDiff === 0) {
        grouped['Today'].push(file)
      } else if (dayDiff <= 1) {
        grouped['Yesterday'].push(file)
      } else if (dayDiff <= 8) {
        grouped['Last seven days'].push(file)
      } else if (monthDiff === 0) {
        grouped['Earlier this month'].push(file)
      } else if (yearDiff === 0) {
        grouped['Earlier this year'].push(file)
      } else {
        grouped['Earlier'].push(file)
      }
    })
  return grouped
}
</script>
