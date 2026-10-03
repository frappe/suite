<!--
  An app's own secondary column.

  It sits *under* the app's header, not beside it: the header names the whole
  app, so it spans the whole app. Only the body is split. With the shell's
  rail now given over to the app list, this is where a mailbox list or a mini
  month lives.

  The panel-header slot is pinned above the scroll area rather than inside it,
  for content that has to overlay the list — Mail's account switcher opens a
  card downwards, and a scroll container would clip it.

  On a phone there is no room for a second column, so the panel is dropped
  here and reached through the shell's bottom sheet instead.
-->
<template>
  <div class="flex min-h-0 min-w-0 flex-1">
    <div
      v-if="!isMobile"
      class="flex w-56 shrink-0 flex-col"
      :class="
        panelStyle === 'fill' ? 'bg-surface-gray-1' : 'border-r border-outline-gray-1'
      "
    >
      <div v-if="$slots['panel-header']" class="relative z-20 shrink-0 px-2 pt-2">
        <slot name="panel-header" />
      </div>

      <ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pb-10 pt-2">
        <slot name="panel" />
      </ScrollArea>
    </div>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ScrollArea } from 'frappe-ui'

import { isMobile } from '../useIsMobile'
import { panelStyle } from '../usePanelStyle'
</script>
