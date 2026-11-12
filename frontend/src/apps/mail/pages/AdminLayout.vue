<template>
  <div class="mail-app h-full min-h-0"><RouterView /></div>
</template>

<script setup lang="ts">
import { provide } from 'vue'

import { userStore } from '@/apps/mail/stores/user'
import dayjs from '@/apps/mail/utils/dayjs'

provide('$user', userStore().userResource)
provide('$dayjs', dayjs)
</script>
