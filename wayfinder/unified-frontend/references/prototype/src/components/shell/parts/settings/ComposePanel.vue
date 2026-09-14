<template>
  <SettingList>
    <div>
      <div class="text-base font-medium text-ink-gray-8">Sender</div>
      <p class="mt-0.5 text-p-sm text-ink-gray-6">The name and address people see on your mail.</p>
      <div class="mt-3 grid grid-cols-2 gap-4">
        <label class="block min-w-0">
          <span class="text-p-sm text-ink-gray-6">Name</span>
          <TextInput v-model="senderName" class="mt-1 w-full" />
        </label>
        <label class="block min-w-0">
          <span class="text-p-sm text-ink-gray-6">Email</span>
          <Select v-model="senderAddress" :options="SENDER_ADDRESSES" class="mt-1 w-full" />
        </label>
      </div>
    </div>

    <SettingRow
      title="Undo send"
      description="How long a sent message waits, so you can still take it back."
    >
      <Select v-model="undoSendSeconds" :options="UNDO_SEND_SECONDS" class="w-44" />
    </SettingRow>

    <label class="block">
      <span class="text-base font-medium text-ink-gray-8">Signature</span>
      <p class="mt-0.5 text-p-sm text-ink-gray-6">Added to the end of every message you write.</p>
      <textarea
        v-model="signature"
        rows="4"
        class="mt-3 w-full resize-none rounded-4 border-0 bg-surface-gray-2 p-2.5 text-base text-ink-gray-8 placeholder:text-ink-gray-4 focus:bg-surface-white focus:outline-none focus:ring-2 focus:ring-outline-gray-3"
      />
    </label>
  </SettingList>
</template>

<script setup lang="ts">
import { Select, TextInput } from 'frappe-ui'

import {
  SENDER_ADDRESSES,
  UNDO_SEND_SECONDS,
  senderAddress,
  senderName,
  signature,
  undoSendSeconds,
} from '../../mailSettings'
import SettingList from './SettingList.vue'
import SettingRow from './SettingRow.vue'
</script>
