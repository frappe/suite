<!--
  A workspace's mark: its first letter on a tile.

  One kind for every workspace, rather than a brand tile for one and a face
  for another, so the switcher never has a row that looks unlike its
  neighbours — including workspaces made later, which have no artwork of their
  own to draw.

  The caller owns the size and the type scale through classes.
-->
<template>
  <span
    class="grid shrink-0 place-items-center rounded-3 bg-surface-gray-3 font-medium text-ink-gray-8"
    aria-hidden="true"
  >
    {{ initial }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { Workspace } from '../fixtures'

const props = defineProps<{ workspace: Workspace }>()

const initial = computed(() => props.workspace.name.trim().charAt(0).toUpperCase())
</script>
