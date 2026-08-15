<!-- PROTOTYPE — remove. Solid "New" button with a static create dropdown. -->
<template>
  <Dropdown :options="NEW_MENU_ITEMS" align="end">
    <Button variant="solid" label="New" icon-left="lucide-plus" />
  </Dropdown>
</template>

<script setup lang="ts">
import { Button, Dropdown } from 'frappe-ui'

import { NEW_MENU_ITEMS } from '../fixtures'
</script>
