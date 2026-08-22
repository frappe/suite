<!--
  PROTOTYPE — remove. The one area backed by real data: it mounts an app's real
  editor in the shell's content pane, so a file click opens the document without
  the rail and the sidebar going anywhere.

  Which document comes from the URL (`doc/<app>/<id>`); which rows carry an id
  comes from fixtures.ts. Everything else in the prototype is still fake.
-->
<template>
  <div class="flex h-full min-h-0 flex-1 flex-col">
    <div v-if="!target" class="flex flex-1 items-center justify-center">
      <span class="text-base text-ink-gray-5">That document is not in this workspace.</span>
    </div>

    <!-- The apps' route modules are lazy, and so are their editors. Holding the
         pane empty until both land keeps the shell from flashing a half-built
         editor. -->
    <div v-else-if="!ready" class="flex flex-1 items-center justify-center">
      <LoadingIndicator class="size-5 text-ink-gray-5" />
    </div>

    <template v-else>
      <!-- The shell owns the document's title bar. The apps draw none of their
           own here, so this is the only place the name appears. -->
      <PageHeader>
        <div class="min-w-0 truncate text-xl font-semibold text-ink-gray-9">
          {{ title }}
        </div>
      </PageHeader>
      <component
        :is="PANES[target.app]"
        :id="target.id"
        :key="`${target.app}:${target.id}`"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, type Component } from 'vue'
import { LoadingIndicator, PageHeader } from 'frappe-ui'

import { ensureAppRoutesLoaded } from '@/router'

import { rowForDoc, type DocApp } from '../fixtures'
import { useShellNav } from '../useShellNav'

// Lazy so the shell bundle does not pull in three editors it may never show.
const PANES: Record<DocApp, Component> = {
  writer: defineAsyncComponent(() => import('../parts/WriterDoc.vue')),
  sheets: defineAsyncComponent(() => import('../parts/SheetDoc.vue')),
  slides: defineAsyncComponent(() => import('../parts/SlidesDoc.vue')),
  // No app behind this one: the shell draws the preview itself.
  pdf: defineAsyncComponent(() => import('../parts/PdfDoc.vue')),
}

const { openDoc } = useShellNav()

const target = computed(() => openDoc.value)

// The fixture row is the title: its names were matched to the real documents,
// so nothing has to be fetched before the header can be drawn.
// A PDF reached from a mail attachment is in no folder, so it has no row. Its
// id is already the file name, which is what the header wants anyway.
const title = computed(() => {
  const ref = target.value
  if (!ref) return ''
  return rowForDoc(ref)?.name ?? (ref.app === 'pdf' ? ref.id : '')
})
const ready = ref(false)

/**
 * The suite router registers an app's real routes only on the first navigation
 * into its prefix, and that registration is also what runs the app's module
 * side effects (writer fetches its user list and translations; slides installs
 * its guards). Reaching an editor from the prototype skips all of it, so ask
 * for it by hand before mounting.
 */
watch(
  target,
  async (next) => {
    ready.value = false
    if (!next) return
    await ensureAppRoutesLoaded(next.app)
    // The URL can change while the import is in flight; only the current target
    // is allowed to open the pane.
    if (target.value?.id === next.id) ready.value = true
  },
  { immediate: true },
)
</script>
