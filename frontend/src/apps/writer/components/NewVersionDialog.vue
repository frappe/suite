<template>
  <FormControl v-model="versionName" autofocus label="Name:" autocomplete="off">
    <template #prefix>
      <LucideVersion class="size-4" />
    </template>
  </FormControl>
  <Button type="submit" label="Create" variant="solid" class="w-full mt-5" :loading="document.newVersion.loading"
    :disabled="!versionName" @click="
      async () => {
        const version = await document.newVersion.submit({
          data,
          title: versionName,
        })
        document.doc.versions.push(version)
        clearDialogs()
      }
    " />
</template>
<script setup>
import { ref } from 'vue'
import { Button, FormControl } from 'frappe-ui'
import { clearDialogs } from '@/apps/writer/utils/dialogs'
import LucideVersion from '~icons/lucide/git-pull-request-create'

const versionName = ref('')
const props = defineProps({
  data: String,
  document: Object,
})
</script>
