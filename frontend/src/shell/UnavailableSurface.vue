<template>
  <section
    class="flex min-h-full items-center justify-center px-5 py-16"
    aria-labelledby="unavailable-title"
  >
    <div class="w-full max-w-md text-center">
      <div
        class="mx-auto grid size-12 place-items-center rounded-full bg-surface-gray-2 text-ink-gray-5"
      >
        <span class="lucide-circle-slash-2 size-6" aria-hidden="true" />
      </div>
      <h1 id="unavailable-title" class="mt-4 text-2xl-semibold text-ink-gray-9">
        {{ title }}
      </h1>
      <p class="mt-2 text-p-base text-ink-gray-6">{{ reason }}</p>
      <p class="mt-3 text-p-sm text-ink-gray-5">{{ nextStep }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    reason: string;
    nextStep: string;
  }>(),
  { title: "This area is unavailable" },
);
</script>
