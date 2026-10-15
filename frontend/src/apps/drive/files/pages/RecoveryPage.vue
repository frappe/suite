<template>
  <div class="flex min-w-0 flex-1 flex-col text-ink-gray-8">
    <AreaSidebar area="files" title="Drive">
      <FilesPanel />
    </AreaSidebar>
    <PageHeader class="hidden md:flex">
      <h1 class="text-lg-semibold text-ink-gray-9">{{ RECOVERY_COPIES_TITLE }}</h1>
    </PageHeader>
    <PageHeaderMobile class="md:hidden">
      <span class="block truncate text-lg font-medium text-ink-gray-9">{{
        RECOVERY_COPIES_TITLE
      }}</span>
    </PageHeaderMobile>
    <div class="flex flex-1 flex-col px-5 py-4">
      <component :is="section" v-for="(section, index) in sections" :key="index" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { PageHeader, PageHeaderMobile } from 'frappe-ui'
import { defineAsyncComponent, inject } from 'vue'

import { AreaSidebar } from '@/platform/area-sidebar'
import { DOCUMENT_TYPES_KEY } from '@/platform/contracts'

import FilesPanel from './FilesPanel.vue'
import { RECOVERY_COPIES_TITLE } from './recoveryCopies'

/** Each document type's work kept on this device, listed by the type itself. */
const documentTypes = inject(DOCUMENT_TYPES_KEY, [])
const sections = documentTypes.flatMap((type) => {
  if (!type.loadUnsavedWork) {
    return []
  }

  return [defineAsyncComponent(type.loadUnsavedWork)]
})
</script>
