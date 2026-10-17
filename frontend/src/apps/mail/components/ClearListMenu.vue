<template>
  <!-- Clearing what the list shows in one go, on its own toolbar: an Inbox tab, or a whole folder.
       Drawn as the toolbar's own buttons are. -->
  <Dropdown :options="menuFor(scope)" align="end">
    <Button variant="ghost" :tooltip="__('More')" :aria-label="__('More')">
      <template #icon>
        <span class="lucide-ellipsis icon" aria-hidden="true" />
      </template>
    </Button>
  </Dropdown>
</template>

<script setup lang="ts">
import { Button, Dropdown } from 'frappe-ui'

import {
  useClearList,
  type ClearScope,
  type ClearTarget,
} from '@/apps/mail/composables/useClearList'

const { scope, target } = defineProps<{ scope: ClearScope; target: ClearTarget }>()

const { menuFor } = useClearList(() => target)
</script>
