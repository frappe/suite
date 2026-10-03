<template>
  <!-- The icon shows the layout you are in, not the click: the pane open beside the
	     list while the split is up, closed against it once the list runs full width.
	     The tooltip is the half that says what the click does. -->
  <Button
    variant="ghost"
    :tooltip="showReadingPane ? __('Disable Split View') : __('Enable Split View')"
    @click="toggleReadingPane()"
  >
    <template #icon>
      <component :is="showReadingPane ? PanelLeftOpen : PanelLeftClose" class="icon" />
    </template>
  </Button>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'

import { useReadingPane, useToggleReadingPane } from '@/apps/mail/utils/composables'

const showReadingPane = useReadingPane()
const toggleReadingPane = useToggleReadingPane()
</script>
