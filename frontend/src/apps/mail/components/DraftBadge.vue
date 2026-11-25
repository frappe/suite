<template>
  <!-- A draft, wherever mail says it is one: in red, as mail apps mark one, and plain, a word beside
       the name rather than a chip among the gray ones. -->
  <Badge :label="__('Draft')" theme="red" variant="ghost" />
</template>

<script setup lang="ts">
import { Badge } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'
</script>
