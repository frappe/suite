<!-- PROTOTYPE — remove. Static mini month (August 2026, today = 15). -->
<template>
  <!-- No horizontal padding: the sidebar's scroll viewport already owns the
       px-2 gutter. -->
  <div class="py-2">
    <div class="flex items-center justify-between px-1 pb-2">
      <span class="text-sm font-medium text-ink-gray-8">August 2026</span>
      <div class="flex items-center gap-1 text-ink-gray-5">
        <span class="lucide-chevron-left size-4" aria-hidden="true" />
        <span class="lucide-chevron-right size-4" aria-hidden="true" />
      </div>
    </div>
    <div class="grid grid-cols-7 gap-y-0.5 text-center text-2xs text-ink-gray-5">
      <span v-for="d in ['M', 'T', 'W', 'T2', 'F', 'S', 'S2']" :key="d" class="py-0.5">
        {{ d.charAt(0) }}
      </span>
      <span v-for="b in 5" :key="`blank-${b}`" />
      <span
        v-for="day in 31"
        :key="day"
        class="mx-auto flex size-6 items-center justify-center rounded-full text-xs"
        :class="
          day === 15
            ? 'bg-surface-gray-7 font-medium text-ink-gray-1'
            : 'text-ink-gray-7'
        "
      >
        {{ day }}
      </span>
    </div>
  </div>
</template>
