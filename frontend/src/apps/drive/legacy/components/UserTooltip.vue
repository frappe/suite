<template>
  {{}}
  <Tooltip :text="email">
    <span>{{ siteUsers.data.find((k) => k.name === email).full_name }}</span>
  </Tooltip>
</template>
<script setup>
import { siteUsers } from '@/apps/drive/resources/permissions'
import { Tooltip } from 'frappe-ui'
defineProps({
  email: String,
})
</script>
