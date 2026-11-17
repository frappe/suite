/**
 * The dot on an area icon's top-right corner, on the rail and the phone bottom
 * nav. The unread dot and the area progress dot share this spot.
 *
 * The 6 px dot is centred 2 px in from the icon box's right edge and 4 px down
 * from its top: the top-right corner of the area glyphs' bodies on their 24 px
 * grid (Mail's envelope, Calendar's page). Centred 2 px down, it sat above the
 * envelope's corner.
 *
 * While a dot is drawn, its host cuts a hole 1 px wider than the dot out of the
 * glyph, so the gap shows whatever is behind the icon: the rail, a hovered or
 * an active item, in either theme. A ring painted in one colour matched only
 * some of those backgrounds and showed as a halo on the others.
 */
export const ICON_DOT = 'absolute -right-px top-px block size-1.5 rounded-full'

/** For the element that holds the icon's `<svg>` and its dot, marked `data-icon-dot`. */
export const ICON_DOT_HOST =
  '[&:has([data-icon-dot])>svg]:[mask-image:radial-gradient(circle_at_calc(100%-2px)_4px,transparent_4px,#000_4.5px)]'
