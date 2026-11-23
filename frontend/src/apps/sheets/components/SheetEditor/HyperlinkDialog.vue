<template>
  <!-- Hyperlink dialog (Ctrl+L) — stores fmt.hyperlink on the active cell -->
  <Dialog v-model:open="show" title="Insert hyperlink" size="sm">
    <template #default>
      <div class="sn-form-stack">
        <FormControl v-model="text" label="Display text" placeholder="Click here" />
        <FormControl
          v-model="url"
          label="Link URL"
          placeholder="https://example.com"
          @keydown.enter="apply"
        />
      </div>
    </template>
    <template #actions>
      <div class="flex flex-row-reverse gap-2">
        <Button variant="solid" @click="apply">Apply</Button>
        <Button v-if="hasLink" theme="red" @click="remove">Remove</Button>
        <Button @click="show = false">Cancel</Button>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
// The hyperlink form, extracted from SheetEditor/index.vue. The editor opens
// it with the cell's text and link, and applies what it hands back (the text
// and the link are one undo step there).
import { Button, Dialog, FormControl } from 'frappe-ui'
import { ref } from 'vue'

defineProps<{ hasLink: boolean }>()
const emit = defineEmits<{ apply: [link: { text: string; url: string }]; remove: [] }>()

const show = ref(false)
const text = ref('')
const url = ref('')

function open(cellText: string, cellUrl: string) {
  text.value = cellText
  url.value = cellUrl
  show.value = true
}
function apply() {
  show.value = false
  emit('apply', { text: text.value, url: url.value })
}
function remove() {
  show.value = false
  emit('remove')
}

defineExpose({ open })
</script>

<style scoped>
/* Dialog form rows, as in SheetEditor.css. */
.sn-form-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
