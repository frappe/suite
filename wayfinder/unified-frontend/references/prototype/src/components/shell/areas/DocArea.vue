<!--
  Mounts a document preview in the shell's content pane, so a file click opens
  "a document" without the rail and the sidebar going anywhere.

  Which document comes from the URL (`doc/<app>/<id>`); which rows carry an id
  comes from fixtures.ts. There is no backend here, so DocPreview draws a frame
  around the document rather than a real editor.
-->
<template>
  <div class="flex h-full min-h-0 flex-1 flex-col">
    <div v-if="!target" class="flex flex-1 items-center justify-center">
      <span class="text-base text-ink-gray-5">That document is not in this workspace.</span>
    </div>

    <template v-else>
      <!-- The shell owns the document's title bar. On mobile there is no rail
           to leave from, so the header carries a back button to Files instead. -->
      <PageHeader v-if="!isMobile">
        <div class="min-w-0 truncate text-xl font-semibold text-ink-gray-9">
          {{ title }}
        </div>
      </PageHeader>
      <PageHeaderMobile v-else :title="title">
        <template #prefix>
          <PageHeaderBackButton :route="areaTo('files')" />
        </template>
      </PageHeaderMobile>
      <DocPreview :app="target.app" :id="target.id" :key="`${target.app}:${target.id}`" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PageHeader, PageHeaderBackButton, PageHeaderMobile } from 'frappe-ui'

import { rowForDoc } from '../fixtures'
import DocPreview from '../parts/DocPreview.vue'
import { isMobile } from '../useIsMobile'
import { useShellNav } from '../useShellNav'

const { areaTo, openDoc } = useShellNav()

const target = computed(() => openDoc.value)

// The fixture row is the title: its names were matched to the real documents,
// so nothing has to be fetched before the header can be drawn.
const title = computed(() => {
  const ref = target.value
  if (!ref) return ''
  return rowForDoc(ref)?.name ?? (ref.app === 'pdf' ? ref.id : '')
})
</script>
