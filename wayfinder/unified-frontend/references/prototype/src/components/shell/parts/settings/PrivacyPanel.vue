<template>
  <SettingList>
    <SettingRow
      title="Screener"
      description="Mail from new senders waits in the Screener until you let them in."
    >
      <Switch v-model="screenNewSenders" />
    </SettingRow>
    <SettingRow
      title="Load remote images"
      description="Show external images in messages without asking first."
    >
      <Switch v-model="loadRemoteImages" />
    </SettingRow>
    <SettingRow
      title="Suspicious link warnings"
      description="Warn before opening links to mismatched or unusual domains."
    >
      <Switch v-model="suspiciousLinkWarnings" />
    </SettingRow>
    <SettingRow
      title="Trash retention"
      description="How long deleted mail stays in Trash before it goes for good."
    >
      <Select v-model="trashRetention" :options="TRASH_RETENTION" class="w-44" />
    </SettingRow>
  </SettingList>
</template>

<script setup lang="ts">
import { Select, Switch } from 'frappe-ui'

import {
  TRASH_RETENTION,
  loadRemoteImages,
  screenNewSenders,
  suspiciousLinkWarnings,
  trashRetention,
} from '../../mailSettings'
import SettingList from './SettingList.vue'
import SettingRow from './SettingRow.vue'
</script>
