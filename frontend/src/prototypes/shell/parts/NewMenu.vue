<!-- PROTOTYPE — remove. Subtle "New" button with a static create dropdown. -->
<template>
  <Dropdown :options="NEW_MENU_ITEMS" align="end">
    <Button variant="subtle" label="New" icon-right="lucide-chevrons-up-down" />
  </Dropdown>
</template>

<script setup lang="ts">
import { Button, Dropdown } from 'frappe-ui'

import { NEW_MENU_ITEMS } from '../fixtures'
</script>
