<template>
  <PageHeader v-if="!isMobile">
    <PageHeaderTitle :title="__('Home')" />
  </PageHeader>
  <PageHeaderMobile v-else :title="__('Home')" />

  <div class="mx-auto w-full max-w-4xl px-3 pb-40 pt-5 sm:px-5">
    <div class="rounded-6 border border-outline-gray-1 bg-surface-base p-5">
      <p class="text-p-base text-ink-gray-6">
        {{ __("Home content is being prepared.") }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PageHeader, PageHeaderMobile, PageHeaderTitle } from "frappe-ui";

import { isMobile } from "@/shell/useIsMobile";
</script>
