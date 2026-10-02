<!--
  The frame every area icon is drawn in, so the rail's glyphs share one
  language: a 24px grid and a 1.5 stroke in currentColor. A glyph marks its
  other parts with `data-tone`, and the frame sets how strong each tone is:
  - `tint`: the body, filled at 10%. A part that sits in front as its own
    layer (a folder's front, an envelope's flap) gets a second tint, and the
    overlap reads as about 20%.
  - `accent`: the one solid detail, at half strength and with no stroke.
  Only the outline is drawn at full ink.

  Single colour: the item's ink drives the stroke and both tones, so idle,
  hover, active and dark mode need nothing here. The caller sets the size.
-->
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <slot />
  </svg>
</template>

<style scoped>
svg :deep([data-tone="tint"]) {
  fill: currentColor;
  fill-opacity: 0.1;
}
svg :deep([data-tone="accent"]) {
  fill: currentColor;
  fill-opacity: 0.5;
  stroke: none;
}
</style>
