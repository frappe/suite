<template>
  <div
    class="flex min-h-full items-center justify-center bg-surface-base px-5 py-16 text-ink-gray-8"
  >
    <div class="w-full max-w-md text-center">
      <div
        class="mx-auto grid size-12 place-items-center rounded-full bg-surface-gray-2 text-ink-gray-5"
      >
        <span class="lucide-link-2 size-6" aria-hidden="true" />
      </div>
      <h1 class="mt-4 text-2xl-semibold text-ink-gray-9">
        {{ __("Guest access is not ready") }}
      </h1>
      <p class="mt-2 text-p-base text-ink-gray-6">
        {{
          __("This shared link cannot be opened in the new Suite surface yet.")
        }}
      </p>
    </div>
  </div>
</template>
