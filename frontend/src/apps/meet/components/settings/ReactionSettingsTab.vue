<template>
  <SettingsHeader :title="__('Reactions')" />
  <SettingsBody>
    <SettingsRow
      :title="__('Quick emojis')"
      :description="__('Set your favorite emojis for quick reactions.')"
      class="max-sm:flex-wrap max-sm:gap-3"
    >
      <div class="flex flex-wrap items-center gap-2">
        <EmojiPicker
          v-for="(emoji, index) in quickReactions"
          :key="index"
          @select="setQuickReaction(index, $event)"
        >
          <Button
            variant="outline"
            size="lg"
            :label="__('Change quick reaction {0}: {1}', [index + 1, emoji])"
          >
            <template #icon>
              <span class="text-xl leading-none" aria-hidden="true">{{ emoji }}</span>
            </template>
          </Button>
        </EmojiPicker>
      </div>
    </SettingsRow>
  </SettingsBody>
</template>

<script setup lang="ts">
import { Button, SettingsBody, SettingsHeader, SettingsRow } from 'frappe-ui'

import EmojiPicker from '@/platform/emoji-picker/EmojiPicker.vue'
import { translate as __ } from '@/platform/translation'

import { quickReactions, setQuickReaction } from '../../data/quickReactionPreferences'
</script>
