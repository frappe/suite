/** frappe-ui's named palette; the editor stores the name and draws it with these variables. */
export const PALETTE = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'purple',
  'pink',
  'gray',
] as const

export const SWATCHES: readonly { name: string | null; label: string }[] = [
  { name: null, label: 'Default' },
  ...PALETTE.map((name) => ({ name, label: name[0].toUpperCase() + name.slice(1) })),
]

/** The palette's variables, which are set on the editor's element, for a menu that opens outside it. */
export function paletteVariables(editorElement: Element): Record<string, string> {
  const style = getComputedStyle(editorElement)
  return Object.fromEntries(
    PALETTE.flatMap((name) =>
      ['color', 'highlight'].map((kind) => {
        const variable = `--prose-${kind}-${name}`
        return [variable, style.getPropertyValue(variable)]
      }),
    ),
  )
}

/** A swatch's border, a light line of its colour. */
export function swatchBorder(name: string | null): string {
  return name
    ? `color-mix(in srgb, var(--prose-color-${name}) 35%, transparent)`
    : 'var(--outline-gray-2)'
}

/** A background colour swatch. */
export function highlightSwatchStyle(name: string | null) {
  return {
    backgroundColor: name ? `var(--prose-highlight-${name})` : undefined,
    borderColor: swatchBorder(name),
  }
}
