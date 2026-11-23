<script setup lang="ts">
import { Alert } from 'frappe-ui'
import { computed, inject, onMounted, shallowRef } from 'vue'
import { useRouter } from 'vue-router'

import { DOCUMENT_TYPES_KEY } from '@/platform/contracts'

const documentTypes = inject(DOCUMENT_TYPES_KEY, [])
const router = useRouter()
// Each kept copy's document, so several copies of one document count once
const documents = shallowRef<string[]>([])

const title = computed(() => {
  const count = new Set(documents.value).size
  if (count === 1) {
    return "1 document has changes that couldn't be saved."
  }

  return `${count} documents have changes that couldn't be saved.`
})
const review = {
  label: 'Review',
  onClick: () => {
    void router.push('/drive/recovery')
  },
}

onMounted(async () => {
  const lists = await Promise.all(documentTypes.map(typeCopies))
  documents.value = lists.flat()
})

async function typeCopies(type: (typeof documentTypes)[number]) {
  const entries = (await type.listUnsavedCopies?.().catch(() => [])) ?? []
  return entries.map((entry) => `${type.key}:${entry.document}`)
}
</script>

<template>
  <Alert v-if="documents.length" :title="title" :primary-action="review" />
</template>
