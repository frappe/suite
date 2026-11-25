<template>
  <SettingsHeader
    :title="__('Reactions')"
    :description="__('Choose which emoji appear in the chat message toolbar.')"
  />
  <SettingsBody>
    <div class="space-y-3 pt-6">
      <h3 class="text-base-medium text-ink-gray-8">{{ __('Quick reactions') }}</h3>
      <div class="flex flex-wrap items-center gap-2">
        <EmojiPicker
          v-for="(emoji, index) in quickReactions"
          :key="index"
          @select="setQuickReaction(index, $event)"
        >
          <Button size="md" :label="__('Change quick reaction {0}: {1}', [index + 1, emoji])">
            <template #icon>
              <span class="text-lg leading-none" aria-hidden="true">{{ emoji }}</span>
            </template>
          </Button>
        </EmojiPicker>
        <Button variant="ghost" :label="__('Reset to defaults')" @click="resetQuickReactions" />
      </div>
    </div>
  </SettingsBody>
</template>

<script setup lang="ts">
import { Button, SettingsBody, SettingsHeader } from 'frappe-ui'

import EmojiPicker from '@/platform/emoji-picker/EmojiPicker.vue'
import { translate as __ } from '@/platform/translation'

import {
  quickReactions,
  resetQuickReactions,
  setQuickReaction,
} from '../../data/quickReactionPreferences'
</script>
