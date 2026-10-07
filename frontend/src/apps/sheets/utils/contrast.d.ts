// Types for contrast.js, so strict TypeScript can import it.

/** WCAG relative luminance in [0, 1]; null for a colour it can't read. */
export function relativeLuminance(color: unknown): number | null
/** True: the fill needs light ink. False: dark ink. Null: unreadable fill. */
export function prefersLightInk(fill: unknown): boolean | null
