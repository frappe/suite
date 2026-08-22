<!--
  PROTOTYPE — remove. Mounts the real Writer editor inside the shell's content
  area, so opening a document does not leave the workspace.

  Writer's own layout is deliberately thin (it assumes a shell above it), so the
  only things it owns that we have to reproduce here are FrappeUIProvider, the
  FDialogs host, and the `inIframe` injection.
-->
<template>
  <FrappeUIProvider>
    <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <!-- useDocument reads the id once, outside a computed, so the editor has
           to be remounted to open a different document. Writer's own route does
           the same thing with :key="$route.fullPath". -->
      <WriterDocument :id="id" :key="id" />
    </div>
    <FDialogs />
  </FrappeUIProvider>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import { FrappeUIProvider } from 'frappe-ui'

import FDialogs from '@/apps/writer/components/FDialogs.vue'
import WriterDocument from '@/apps/writer/pages/Document.vue'

defineProps<{ id: string }>()

// The shell draws the document's title bar, so writer draws neither of its own.
provide('hideChrome', true)

// Writer still reads this to pick between its two bars. It must stay a raw
// boolean: Document.vue's `editable` computed reads `inIframe.value`, which on
// a boolean is undefined and therefore falsy. Hand it a ref and the editor
// mounts read-only.
provide('inIframe', false)
</script>
