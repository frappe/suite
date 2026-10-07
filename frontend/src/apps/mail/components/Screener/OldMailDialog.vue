<template>
  <!-- Asked after a block when the senders still have mail in the Inbox, and the account's setting
	     says to ask. Remembering the answer saves it as that setting (Settings → Account). -->
  <Dialog v-model:open="open" :title="__('Move old mail to Junk?')">
    <template #default>
      <div class="space-y-4">
        <p class="text-p-base text-ink-gray-7">
          {{
            shown?.emails.length === 1
              ? __('{0} has {1} more emails in your Inbox.', [
                  shown.emails[0],
                  String(shown.count),
                ])
              : __('These senders have {0} more emails in your Inbox.', [String(shown?.count)])
          }}
          {{ __('Their mail in other folders stays where it is.') }}
        </p>
        <FormControl v-model="remember" type="checkbox" :label="__('Remember my choice')" />
      </div>
    </template>
    <template #actions>
      <div class="flex justify-end gap-2">
        <Button variant="outline" :label="__('Keep in Inbox')" @click="answer('Keep')" />
        <Button variant="solid" :label="__('Move to Junk')" @click="answer('Move to Junk')" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { useScreener } from '@/apps/mail/composables/useScreener'

const { oldMailPrompt: prompt, junkOldMail, rememberOldMailChoice } = useScreener()

// What the dialog shows, set as it opens and left alone as it closes: the question clears the moment
// it is answered, and reading it straight would change the words while the dialog fades out.
const shown = ref<{ emails: string[]; count: number } | null>(null)
const remember = ref(false)
watch(prompt, (asked) => {
  if (!asked) return
  shown.value = asked
  remember.value = false
})

// Closing it any other way is keeping the mail, once.
const open = computed({
  get: () => !!prompt.value,
  set: (value) => !value && (prompt.value = null),
})

const answer = (choice: 'Move to Junk' | 'Keep') => {
  const asked = prompt.value
  prompt.value = null
  if (!asked) return
  if (remember.value) void rememberOldMailChoice(choice)
  if (choice === 'Move to Junk') void junkOldMail(asked.emails)
}
</script>
