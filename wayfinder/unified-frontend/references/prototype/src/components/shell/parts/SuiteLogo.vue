<!--
  The Suite mark: a white case on the brand tile.

  Traced by eye from the supplied icon, so it is an approximation — swap these
  paths for the real artwork once there is an SVG to hand. The two colours are
  brand constants, not theme tokens, so the tile keeps its identity in dark
  mode. The caller owns the size.
-->
<template>
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <rect width="48" height="48" rx="14" fill="#5546DE" />
    <rect
      x="11.6"
      y="23.4"
      width="24.2"
      height="10.3"
      rx="3.2"
      fill="none"
      stroke="#fff"
      stroke-width="3.2"
    />
    <g fill="#fff">
      <rect x="17.6" y="11.6" width="12.2" height="3" />
      <rect x="10" y="14.4" width="23.4" height="3.3" />
      <rect x="19.5" y="26.4" width="8.4" height="3.7" />
    </g>
  </svg>
</template>
