<script setup lang="ts">
import { ref, watch } from 'vue'
import { ExternalLink, Link2 } from 'lucide-vue-next'
import { Button } from 'frappe-ui'
import { Popover } from 'frappe-ui'
import { TextInput } from 'frappe-ui'

const props = defineProps<{ link?: string }>()
const emit = defineEmits<{ save: [link: string] }>()

const open = ref(false)
const value = ref(props.link ?? '')
const error = ref('')

watch(() => props.link, link => { if (!open.value) value.value = link ?? '' })
watch(open, shown => {
  if (shown) { value.value = props.link ?? ''; error.value = '' }
})

function redirect() {
  if (props.link) window.open(props.link, '_blank', 'noopener,noreferrer')
}

function save() {
  const link = value.value.trim()
  if (link && !/^https?:\/\//i.test(link)) { error.value = 'Use a link starting with http:// or https://.'; return }
  emit('save', link)
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open" side="left" align="end" :offset="120" :collision-padding="16" arrow>
    <template #trigger>
      <Button v-if="!props.link" size="xs" variant="subtle" theme="gray" label="Add link" tooltip="Add link"><Link2 class="size-4" :stroke-width="1.5" /></Button>
      <Button v-else size="xs" variant="subtle" theme="gray" label="Open link" tooltip="Open link" @click.stop="redirect"><ExternalLink class="size-4" :stroke-width="1.5" /></Button>
    </template>
    <form class="link-popover" @submit.prevent="save">
      <h3>Add link</h3>
      <TextInput v-model="value" type="url" aria-label="Web link" placeholder="https://example.com" autofocus @update:model-value="error = ''" @keydown.esc="open = false" />
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="actions"><Button type="button" size="sm" variant="subtle" theme="gray" @click="open = false">Cancel</Button><Button type="submit" size="sm" variant="solid" theme="blue">Save</Button></div>
    </form>
  </Popover>
</template>

<style scoped>
.link-popover { width: 264px; padding: 18px; color: var(--ink-gray-7); }
h3 { margin: 0 0 8px; color: var(--ink-gray-7); font-size: 13px; font-weight: 400; line-height: 20px; }
p { margin: 8px 0 0; color: var(--ink-red-3, #b52a2a); font-size: 12px; line-height: 16px; }
.actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 16px; }
</style>
