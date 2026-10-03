<template>
  <!-- Indeterminate hairline progress bar under a toolbar: absolutely pinned to the
	     nearest positioned ancestor's bottom edge, overlapping its border by 1px so the
	     sweep replaces the border line rather than stacking under it. -->
  <div
    class="loading-bar pointer-events-none absolute bottom-[-1px] left-[-1px] right-0 h-0.5 overflow-hidden"
    role="progressbar"
    aria-busy="true"
  >
    <div
      class="loading-bar__fill via-ink-gray-3 absolute inset-y-0 left-0 w-[30%] bg-gradient-to-r from-transparent to-transparent"
    />
  </div>
</template>

<style scoped>
.loading-bar__fill {
  animation: loading-bar-slide 1.2s linear infinite;
}

@keyframes loading-bar-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(333%);
  }
}
</style>
